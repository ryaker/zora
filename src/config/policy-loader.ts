/**
 * Policy Loader — centralized TOML → ZoraPolicy parsing.
 *
 * Replaces duplicated policy parsing in cli/index.ts and cli/daemon.ts.
 * Handles backward compatibility: missing sections use safe defaults.
 */

import fs from 'node:fs';
import type { ZoraPolicy } from '../types.js';

/**
 * Load and parse a ZoraPolicy from a TOML file.
 * Throws descriptive errors for missing files, missing dependencies, and parse failures.
 */
export async function loadPolicy(policyPath: string): Promise<ZoraPolicy> {
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Policy file not found at ${policyPath}. Run \`zora init\` first.`);
  }

  let parseTOML: (input: string) => Record<string, unknown>;
  try {
    const mod = await import('smol-toml');
    parseTOML = mod.parse as (input: string) => Record<string, unknown>;
  } catch {
    throw new Error(
      'Failed to load TOML parser (smol-toml). Run `npm install` to install dependencies.',
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseTOML(fs.readFileSync(policyPath, 'utf-8'));
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${policyPath}: ${detail}`);
  }

  return parsePolicy(raw);
}

/**
 * Parse a ZoraPolicy from raw TOML data.
 * Applies safe defaults for any missing sections or fields.
 */
export function parsePolicy(raw: Record<string, unknown>): ZoraPolicy {
  const fsPol = raw['filesystem'] as Record<string, unknown> | undefined;
  const shPol = raw['shell'] as Record<string, unknown> | undefined;
  const actPol = raw['actions'] as Record<string, unknown> | undefined;
  const netPol = raw['network'] as Record<string, unknown> | undefined;
  const budPol = raw['budget'] as Record<string, unknown> | undefined;
  const dryPol = raw['dry_run'] as Record<string, unknown> | undefined;

  const policy: ZoraPolicy = {
    filesystem: {
      allowed_paths: (fsPol?.['allowed_paths'] as string[]) ?? [],
      denied_paths: (fsPol?.['denied_paths'] as string[]) ?? [],
      resolve_symlinks: (fsPol?.['resolve_symlinks'] as boolean) ?? true,
      follow_symlinks: (fsPol?.['follow_symlinks'] as boolean) ?? false,
    },
    shell: {
      mode: (shPol?.['mode'] as 'allowlist' | 'denylist' | 'deny_all') ?? 'allowlist',
      allowed_commands: (shPol?.['allowed_commands'] as string[]) ?? ['ls', 'npm', 'git'],
      denied_commands: (shPol?.['denied_commands'] as string[]) ?? [],
      split_chained_commands: (shPol?.['split_chained_commands'] as boolean) ?? true,
      max_execution_time: (shPol?.['max_execution_time'] as string) ?? '1m',
    },
    actions: {
      reversible: (actPol?.['reversible'] as string[]) ?? [],
      irreversible: (actPol?.['irreversible'] as string[]) ?? [],
      always_flag: (actPol?.['always_flag'] as string[]) ?? [],
    },
    network: {
      allowed_domains: (netPol?.['allowed_domains'] as string[]) ?? [],
      denied_domains: (netPol?.['denied_domains'] as string[]) ?? [],
      max_request_size: (netPol?.['max_request_size'] as string) ?? '10mb',
    },
  };

  if (budPol) {
    policy.budget = {
      max_actions_per_session: (budPol['max_actions_per_session'] as number) ?? 0,
      max_actions_per_type: (budPol['max_actions_per_type'] as Record<string, number>) ?? {},
      token_budget: (budPol['token_budget'] as number) ?? 0,
      on_exceed: (budPol['on_exceed'] as 'block' | 'flag') ?? 'block',
    };
  }

  if (dryPol) {
    policy.dry_run = {
      enabled: (dryPol['enabled'] as boolean) ?? false,
      tools: (dryPol['tools'] as string[]) ?? [],
      audit_dry_runs: (dryPol['audit_dry_runs'] as boolean) ?? true,
    };
  }

  return policy;
}
