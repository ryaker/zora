/**
 * ChannelIdentityRegistry — loads and manages channel policy configuration.
 *
 * Reads config/channel-policy.toml and provides:
 *   - User trust definitions (phone → role mappings)
 *   - Capability set definitions (role → allowed tools)
 *   - Hot-reload on SIGHUP
 *
 * INVARIANT-3: Unknown senders receive NO response
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { CapabilitySet } from "../types/channel.js";

// Using smol-toml or @iarna/toml if available, fallback to manual parse
// Try dynamic import to handle either package
async function loadTomlParser(): Promise<(content: string) => Record<string, unknown>> {
  try {
    const { parse } = await import("smol-toml" as string);
    return parse as (content: string) => Record<string, unknown>;
  } catch {
    try {
      const toml = await import("@iarna/toml" as string);
      return toml.parse as (content: string) => Record<string, unknown>;
    } catch {
      // Fallback: basic TOML-like parser for our specific config shape
      // This handles the exact structure of channel-policy.toml
      return parseChannelPolicyToml;
    }
  }
}

/**
 * Basic TOML parser for channel-policy.toml structure.
 * Only handles the exact keys we need — not a general TOML parser.
 */
function parseChannelPolicyToml(_content: string): Record<string, unknown> {
  // We'll use a JSON-compatible approach: convert TOML to a JS object manually
  // This is a limited fallback — recommend installing smol-toml
  throw new Error(
    "No TOML parser available. Install smol-toml: npm install smol-toml\n" +
    "Or @iarna/toml: npm install @iarna/toml"
  );
}

export interface UserPolicy {
  phone: string;
  name: string;
  channels: string[];          // ["all"] or ["group:uuid", ...]
  role: string;                // "trusted_admin" | "trusted_user" | "read_only"
  dm_role?: string;            // Override role for direct messages
}

export interface CapabilitySetConfig {
  tools: string[];
  destructive_ops: boolean;
  action_budget: number;
  param_constraints?: {
    bash?: { command_allowlist?: string[]; command_blocklist?: string[] };
    write_file?: { path_allowlist?: string[] };
  };
}

export interface ChannelPolicyConfig {
  signal?: {
    phone_number?: string;
    signal_cli_path?: string;
    linked_device?: boolean;
    daemon_port?: number;
    auto_trust_new_identities?: boolean;
  };
  channels?: {
    prompt_injection?: {
      enabled?: boolean;
      scanner_url?: string;
      block_on_high_risk?: boolean;
    };
    quarantine?: {
      enabled?: boolean;
      model?: string;
      /** #250: LLM backend for quarantine. Unset = derive from the primary provider. */
      provider?: "claude-sdk" | "ollama";
      endpoint?: string;
    };
  };
  channel_policy?: {
    users?: UserPolicy[];
  };
  capability_sets?: Record<string, CapabilitySetConfig>;
}

export class ChannelIdentityRegistry {
  private config: ChannelPolicyConfig = {};
  private configPath: string;
  private reloadCallbacks: Array<() => void> = [];

  private constructor(configPath: string) {
    this.configPath = resolve(configPath);
  }

  /**
   * Load registry from TOML file.
   * Throws if file doesn't exist or has invalid structure.
   */
  static async load(configPath: string): Promise<ChannelIdentityRegistry> {
    const registry = new ChannelIdentityRegistry(configPath);
    await registry.reload();
    return registry;
  }

  /**
   * Reload configuration from disk.
   * Called on startup and on SIGHUP.
   */
  async reload(): Promise<void> {
    const parse = await loadTomlParser();
    const content = readFileSync(this.configPath, "utf-8");
    this.config = parse(content) as ChannelPolicyConfig;
    this.reloadCallbacks.forEach(cb => cb());
  }

  /** Register a callback to be called when config is hot-reloaded */
  onReload(callback: () => void): void {
    this.reloadCallbacks.push(callback);
  }

  /** Get all user policies */
  getUsers(): UserPolicy[] {
    return this.config.channel_policy?.users ?? [];
  }

  /**
   * Get a specific user policy by phone number.
   * Normalizes input to handle minor formatting differences before lookup.
   */
  getUser(phone: string): UserPolicy | undefined {
    // Normalize both sides: strip formatting, ensure + prefix for consistent comparison.
    const norm = (p: string) => {
      const stripped = p.trim().replace(/[\s\-().]/g, "");
      return stripped.startsWith("+") ? stripped : "+" + stripped;
    };
    const lookup = norm(phone);
    return this.getUsers().find(u => norm(u.phone) === lookup);
  }

  /** Get all capability set definitions */
  getCapabilitySets(): Record<string, CapabilitySetConfig> {
    return this.config.capability_sets ?? {};
  }

  /** Get raw capability set config (snake_case) for a given role */
  getCapabilitySetConfig(role: string): CapabilitySetConfig | undefined {
    return this.getCapabilitySets()[role];
  }

  /**
   * Get a fully-typed CapabilitySet (camelCase) for a given role and sender.
   * Transforms snake_case TOML config fields to the CapabilitySet interface.
   * Returns undefined when the role is not found.
   */
  getCapabilitySet(role: string, senderPhone: string, channelId: string): CapabilitySet | undefined {
    const cfg = this.getCapabilitySetConfig(role);
    if (!cfg) return undefined;
    return {
      senderPhone,
      channelId,
      role,
      allowedTools: cfg.tools ?? [],
      destructiveOpsAllowed: cfg.destructive_ops ?? false,
      actionBudget: cfg.action_budget ?? 0,
      paramConstraints: cfg.param_constraints ? {
        bash: cfg.param_constraints.bash ? {
          commandAllowlist: cfg.param_constraints.bash.command_allowlist,
          commandBlocklist: cfg.param_constraints.bash.command_blocklist,
        } : undefined,
        write_file: cfg.param_constraints.write_file ? {
          pathAllowlist: cfg.param_constraints.write_file.path_allowlist,
        } : undefined,
      } : undefined,
    };
  }

  /** Get Signal daemon configuration */
  getSignalConfig(): ChannelPolicyConfig["signal"] {
    return this.config.signal;
  }

  /** Get quarantine model name */
  getQuarantineModel(): string {
    return this.config.channels?.quarantine?.model ?? "claude-haiku-4-5-20251001";
  }

  /** #250: explicit quarantine backend settings (all optional). */
  getQuarantineSettings(): { model?: string; provider?: "claude-sdk" | "ollama"; endpoint?: string } {
    const q = this.config.channels?.quarantine;
    return { model: q?.model, provider: q?.provider, endpoint: q?.endpoint };
  }

  /** Get prompt injection config */
  getPromptInjectionConfig(): NonNullable<ChannelPolicyConfig["channels"]>["prompt_injection"] {
    return this.config.channels?.prompt_injection;
  }

  /**
   * Set up hot-reload via SIGHUP.
   * Call once after registry is loaded.
   */
  listenForReload(): void {
    process.on("SIGHUP", async () => {
      try {
        console.log("[policy] SIGHUP received — reloading channel policy...");
        await this.reload();
        const userCount = this.getUsers().length;
        const setCount = Object.keys(this.getCapabilitySets()).length;
        console.log(`[policy] Config reloaded: ${userCount} users, ${setCount} capability sets`);
      } catch (err) {
        console.error("[policy] Config reload failed:", err);
      }
    });
  }
}
