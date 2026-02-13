/**
 * PolicyEngine — Enforcement of the Zora security policy.
 *
 * Spec §5.3 "Capability Policy Engine":
 *   - Path resolution (resolving ~, canonicalization)
 *   - Symlink handling (follow_symlinks check)
 *   - Command allowlist validation
 *   - Chained command splitting
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ZoraPolicy, FilesystemPolicy } from '../types.js';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath?: string;
}

export interface AccessCheckResult {
  paths: Record<string, { allowed: boolean; reason?: string }>;
  commands: Record<string, { allowed: boolean; reason?: string }>;
  suggestion?: string;
}

/**
 * Callback for flagged actions. Return true to allow, false to deny.
 * Used when always_flag is configured in policy.
 */
export type FlagCallback = (action: string, detail: string) => Promise<boolean>;

/**
 * Request to expand the policy at runtime.
 */
export interface PolicyExpansionRequest {
  paths?: string[];
  commands?: string[];
}

export class PolicyEngine {
  private _policy: ZoraPolicy;
  private readonly _homeDir: string;
  private _flagCallback?: FlagCallback;
  private _policyFilePath?: string;

  constructor(policy: ZoraPolicy, flagCallback?: FlagCallback) {
    this._policy = policy;
    this._homeDir = os.homedir();
    this._flagCallback = flagCallback;
  }

  /**
   * Sets the path to the policy.toml file for runtime persistence.
   */
  setPolicyFilePath(filePath: string): void {
    this._policyFilePath = filePath;
  }

  /**
   * Sets the flag callback for always_flag enforcement.
   */
  setFlagCallback(callback: FlagCallback): void {
    this._flagCallback = callback;
  }

  /**
   * Validates if a filesystem path is allowed according to policy.
   */
  validatePath(targetPath: string): ValidationResult {
    const fsPolicy = this._policy.filesystem;
    
    // 1. Resolve path (expand ~ and make absolute)
    let absolutePath = this._resolveHome(targetPath);
    absolutePath = path.resolve(absolutePath);

    // 2. Symlink check (Spec §5.3: "Don't follow symlinks outside allowed boundaries")
    if (!fsPolicy.follow_symlinks && this._isSymlink(absolutePath)) {
      try {
        const realPath = fs.realpathSync(absolutePath);
        
        // Deny symlinks that resolve into explicitly denied paths
        if (this._isWithinDeniedPaths(realPath, fsPolicy)) {
          return {
            allowed: false,
            reason: `Symlink target ${realPath} is explicitly denied by security policy`,
          };
        }

        if (!this._isWithinAllowedPaths(realPath, fsPolicy)) {
          return {
            allowed: false,
            reason: `Symlink target ${realPath} is outside allowed boundaries`,
          };
        }
      } catch (err: unknown) {
        // If file doesn't exist yet (e.g. for write_file), we skip realpath check,
        // but other errors should lead to failure.
        if (!(err instanceof Error && 'code' in err && (err as any).code === 'ENOENT')) {
          return {
            allowed: false,
            reason: `Error resolving symlink ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    // 3. Deny takes precedence
    if (this._isWithinDeniedPaths(absolutePath, fsPolicy)) {
      return {
        allowed: false,
        reason: `Access to ${targetPath} is explicitly denied by security policy`,
      };
    }

    // 4. Check allowlist
    if (!this._isWithinAllowedPaths(absolutePath, fsPolicy)) {
      return {
        allowed: false,
        reason: `Access to ${targetPath} is not permitted by current capability policy`,
      };
    }

    return { allowed: true, resolvedPath: absolutePath };
  }

  /**
   * Validates if a shell command is allowed.
   * Splits chained commands if configured and validates each component.
   */
  validateCommand(command: string): ValidationResult {
    const shellPolicy = this._policy.shell;

    // In deny_all mode, no shell commands should be executed at all.
    if (shellPolicy.mode === 'deny_all') {
      return {
        allowed: false,
        reason: 'Shell command execution is disabled by security policy',
      };
    }

    if (shellPolicy.mode === 'allowlist') {
      const commandsToValidate = shellPolicy.split_chained_commands 
        ? this._splitChainedCommands(command) 
        : [command];

      for (const cmd of commandsToValidate) {
        const baseCommand = this._extractBaseCommand(cmd);
        
        // Check denied list first
        if (shellPolicy.denied_commands.includes(baseCommand)) {
          return {
            allowed: false,
            reason: `Command '${baseCommand}' is explicitly forbidden by security policy`,
          };
        }

        // Check allowlist
        if (!shellPolicy.allowed_commands.includes(baseCommand)) {
          return {
            allowed: false,
            reason: `Command '${baseCommand}' is not in the allowlist. Only pre-approved commands are permitted.`,
          };
        }
      }
    } else {
      // Denylist mode (less secure, but supported)
      const baseCommand = this._extractBaseCommand(command);
      if (shellPolicy.denied_commands.includes(baseCommand)) {
        return {
          allowed: false,
          reason: `Command '${baseCommand}' is forbidden by security policy`,
        };
      }
    }

    return { allowed: true };
  }

  // ─── SDK Integration ──────────────────────────────────────────────

  /**
   * Creates a canUseTool callback compatible with the Claude Agent SDK.
   * Maps Zora's policy validation to SDK permission decisions.
   *
   * The SDK calls this before every tool execution. Return:
   *   { behavior: 'allow', updatedInput } to permit
   *   { behavior: 'deny', message } to block
   */
  createCanUseTool(): (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<
    | { behavior: 'allow'; updatedInput: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
  > {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      _options: { signal: AbortSignal },
    ) => {
      // Bash / shell commands
      if (toolName === 'Bash') {
        const command = input['command'] as string | undefined;
        if (!command) {
          return {
            behavior: 'deny' as const,
            message: 'Bash tool invoked without a command — denied by policy',
          };
        }
        const result = this.validateCommand(command);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Command denied by policy',
          };
        }
      }

      // File operations: Read, Write, Edit
      if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
        const filePath = input['file_path'] as string | undefined;
        if (!filePath) {
          return {
            behavior: 'deny' as const,
            message: `${toolName} tool invoked without a file_path — denied by policy`,
          };
        }
        const result = this.validatePath(filePath);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Path denied by policy',
          };
        }
      }

      // Glob — validate the search path if provided
      if (toolName === 'Glob') {
        const globPath = input['path'] as string | undefined;
        if (!globPath) {
          return {
            behavior: 'deny' as const,
            message: 'Glob tool invoked without a path — denied by policy',
          };
        }
        const result = this.validatePath(globPath);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Path denied by policy',
          };
        }
      }

      // Grep — validate the search path if provided
      if (toolName === 'Grep') {
        const grepPath = input['path'] as string | undefined;
        if (!grepPath) {
          return {
            behavior: 'deny' as const,
            message: 'Grep tool invoked without a path — denied by policy',
          };
        }
        const result = this.validatePath(grepPath);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Path denied by policy',
          };
        }
      }

      // Check always_flag for actions that require approval
      const action = this._classifyAction(toolName, input);
      if (action && this._shouldFlag(action)) {
        if (this._flagCallback) {
          const detail = toolName === 'Bash'
            ? `Command: ${input['command']}`
            : `${toolName}: ${input['file_path'] ?? JSON.stringify(input)}`;

          const approved = await this._flagCallback(action, detail);
          if (!approved) {
            return {
              behavior: 'deny' as const,
              message: `Action '${action}' was flagged for approval and denied by user`,
            };
          }
        }
        // No callback = no enforcement (graceful: config parsed but not blocked)
      }

      // Default: allow the tool call
      return { behavior: 'allow' as const, updatedInput: input };
    };
  }

  /**
   * Maps a tool call to an action category for always_flag matching.
   */
  private _classifyAction(toolName: string, input: Record<string, unknown>): string | null {
    if (toolName === 'Bash') {
      const command = (input['command'] as string | undefined) ?? '';
      const base = this._extractBaseCommand(command);

      // Map common commands to action categories
      if (base === 'git') {
        const args = command.trim().split(/\s+/);
        if (args.includes('push')) return 'git_push';
        if (args.includes('reset') && args.includes('--hard')) return 'shell_exec_destructive';
        return 'git_operation';
      }
      if (['rm', 'rmdir'].includes(base)) return 'shell_exec_destructive';
      if (['chmod', 'chown'].includes(base)) return 'shell_exec_destructive';
      return 'shell_exec';
    }

    if (toolName === 'Write') return 'write_file';
    if (toolName === 'Edit') return 'edit_file';

    return null;
  }

  /**
   * Checks if an action matches any entry in the always_flag list.
   */
  private _shouldFlag(action: string): boolean {
    const flagList = this._policy.actions.always_flag;
    if (flagList.length === 0) return false;
    return flagList.includes('*') || flagList.includes(action);
  }

  // ─── Policy Inspection ──────────────────────────────────────────────

  /**
   * Checks access for multiple paths and commands at once.
   * Used by the check_permissions tool so the agent can plan around its boundaries.
   */
  checkAccess(paths: string[], commands: string[]): AccessCheckResult {
    const pathResults: Record<string, { allowed: boolean; reason?: string }> = {};
    for (const p of paths) {
      const v = this.validatePath(p);
      pathResults[p] = { allowed: v.allowed, ...(v.reason ? { reason: v.reason } : {}) };
    }

    const commandResults: Record<string, { allowed: boolean; reason?: string }> = {};
    for (const c of commands) {
      const v = this.validateCommand(c);
      commandResults[c] = { allowed: v.allowed, ...(v.reason ? { reason: v.reason } : {}) };
    }

    const denied = [
      ...Object.entries(pathResults).filter(([, v]) => !v.allowed).map(([k]) => k),
      ...Object.entries(commandResults).filter(([, v]) => !v.allowed).map(([k]) => k),
    ];

    return {
      paths: pathResults,
      commands: commandResults,
      ...(denied.length > 0 ? { suggestion: 'To access denied resources, ask the user to grant access via `zora init --force` or by editing ~/.zora/policy.toml.' } : {}),
    };
  }

  /**
   * Returns a short text summary of the current policy for system prompt injection.
   * Intentionally terse to minimize context usage.
   */
  getPolicySummary(): string {
    const fs = this._policy.filesystem;
    const sh = this._policy.shell;
    const lines: string[] = [];

    if (fs.allowed_paths.length === 0) {
      lines.push('Filesystem: LOCKED (no paths allowed)');
    } else {
      lines.push(`Filesystem: ${fs.allowed_paths.join(', ')}`);
    }

    if (fs.denied_paths.length > 0) {
      lines.push(`Denied: ${fs.denied_paths.join(', ')}`);
    }

    if (sh.mode === 'deny_all') {
      lines.push('Shell: DISABLED (no commands allowed)');
    } else if (sh.mode === 'allowlist') {
      lines.push(`Shell: ${sh.allowed_commands.join(', ')}`);
    } else {
      lines.push('Shell: denylist mode');
    }

    return lines.join('\n');
  }

  /**
   * Returns the raw policy object (read-only access for serialization).
   */
  get policy(): ZoraPolicy {
    return this._policy;
  }

  // ─── Runtime Policy Expansion ──────────────────────────────────────

  /**
   * Expands the policy at runtime. Validates against permanent deny-list.
   * Persists changes to policy.toml if a file path is configured.
   */
  expandPolicy(request: PolicyExpansionRequest): void {
    // Validate: requested paths must not be in permanent deny-list
    if (request.paths) {
      for (const p of request.paths) {
        const abs = path.resolve(this._resolveHome(p));
        if (this._isWithinDeniedPaths(abs, this._policy.filesystem)) {
          throw new Error(`Cannot grant access to ${p} — permanently denied by policy`);
        }
      }

      // Add new paths (deduplicate)
      const existing = new Set(this._policy.filesystem.allowed_paths);
      for (const p of request.paths) {
        existing.add(p);
      }
      this._policy.filesystem.allowed_paths = [...existing];
    }

    // Expand shell commands
    if (request.commands) {
      const existing = new Set(this._policy.shell.allowed_commands);
      for (const c of request.commands) {
        // Don't allow adding denied commands
        if (this._policy.shell.denied_commands.includes(c)) {
          throw new Error(`Cannot allow command '${c}' — permanently denied by policy`);
        }
        existing.add(c);
      }
      this._policy.shell.allowed_commands = [...existing];

      // If we're adding commands and mode was deny_all, switch to allowlist
      if (this._policy.shell.mode === 'deny_all') {
        this._policy.shell.mode = 'allowlist';
      }
    }

    // Persist if we have a file path
    if (this._policyFilePath) {
      this._writePolicyFile();
    }
  }

  /**
   * Writes the current policy state to the TOML file.
   */
  private _writePolicyFile(): void {
    if (!this._policyFilePath) return;

    try {
      // Dynamic import would be async; since we store the import at module level, use sync write
      // Build TOML manually for simplicity (avoids needing smol-toml at runtime here)
      const lines: string[] = [
        '# Zora Security Policy — auto-generated (runtime expansion applied)',
        '',
        '[filesystem]',
        `allowed_paths = ${JSON.stringify(this._policy.filesystem.allowed_paths)}`,
        `denied_paths = ${JSON.stringify(this._policy.filesystem.denied_paths)}`,
        `resolve_symlinks = ${this._policy.filesystem.resolve_symlinks}`,
        `follow_symlinks = ${this._policy.filesystem.follow_symlinks}`,
        '',
        '[shell]',
        `mode = "${this._policy.shell.mode}"`,
        `allowed_commands = ${JSON.stringify(this._policy.shell.allowed_commands)}`,
        `denied_commands = ${JSON.stringify(this._policy.shell.denied_commands)}`,
        `split_chained_commands = ${this._policy.shell.split_chained_commands}`,
        `max_execution_time = "${this._policy.shell.max_execution_time}"`,
        '',
        '[actions]',
        `reversible = ${JSON.stringify(this._policy.actions.reversible)}`,
        `irreversible = ${JSON.stringify(this._policy.actions.irreversible)}`,
        `always_flag = ${JSON.stringify(this._policy.actions.always_flag)}`,
        '',
        '[network]',
        `allowed_domains = ${JSON.stringify(this._policy.network.allowed_domains)}`,
        `denied_domains = ${JSON.stringify(this._policy.network.denied_domains)}`,
        `max_request_size = "${this._policy.network.max_request_size}"`,
        '',
      ];

      fs.writeFileSync(this._policyFilePath, lines.join('\n'), 'utf-8');
    } catch (err) {
      console.error('[PolicyEngine] Failed to persist policy expansion:', err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private _resolveHome(p: string): string {
    if (p === '~') return this._homeDir;
    if (p.startsWith('~/')) return path.join(this._homeDir, p.slice(2));
    return p;
  }

  private _isSymlink(p: string): boolean {
    try {
      const stats = fs.lstatSync(p);
      return stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  private _isWithinAllowedPaths(p: string, policy: FilesystemPolicy): boolean {
    return policy.allowed_paths.some(allowed => {
      const absAllowed = path.resolve(this._resolveHome(allowed));
      return p === absAllowed || p.startsWith(absAllowed + path.sep);
    });
  }

  private _isWithinDeniedPaths(p: string, policy: FilesystemPolicy): boolean {
    return policy.denied_paths.some(denied => {
      const absDenied = path.resolve(this._resolveHome(denied));
      return p === absDenied || p.startsWith(absDenied + path.sep);
    });
  }

  /**
   * Splits command chains (&&, ||, ;, |) while respecting quoted strings.
   */
  private _splitChainedCommands(command: string): string[] {
    // Simple but more robust parser that respects quotes
    const commands: string[] = [];
    let current = '';
    let inQuote: string | null = null;

    for (let i = 0; i < command.length; i++) {
      const char = command[i]!;
      const nextChar = command[i + 1];

      if ((char === '"' || char === "'") && command[i - 1] !== '\\') {
        if (inQuote === char) {
          inQuote = null;
        } else if (!inQuote) {
          inQuote = char;
        }
        current += char;
      } else if (!inQuote && (char === ';' || (char === '&' && nextChar === '&') || (char === '|' && nextChar === '|'))) {
        if (current.trim()) commands.push(current.trim());
        current = '';
        if (char !== ';') i++; // Skip the second char of && or ||
      } else if (!inQuote && char === '|') {
        if (current.trim()) commands.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) commands.push(current.trim());
    return commands;
  }

  /**
   * Extracts the base binary name from a command string, respecting quotes.
   */
  private _extractBaseCommand(command: string): string {
    const trimmed = command.trim();
    let firstPart = '';
    let inQuote: string | null = null;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i]!;
      if ((char === '"' || char === "'") && trimmed[i - 1] !== '\\') {
        if (inQuote === char) {
          inQuote = null;
        } else if (!inQuote) {
          inQuote = char;
        }
      } else if (!inQuote && /\s/.test(char)) {
        break;
      } else {
        firstPart += char;
      }
    }

    // Remove surrounding quotes from the binary path if they exist
    const binaryPath = firstPart.replace(/^["']|["']$/g, '');
    return path.basename(binaryPath);
  }
}
