/**
 * Policy serialization and summary utilities.
 *
 * Extracted from PolicyEngine to separate concerns:
 * - Human-readable policy summaries (for system prompt injection)
 * - TOML file serialization (for runtime policy persistence)
 */

import fs from 'node:fs';
import type { ZoraPolicy } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('policy-serializer');

/**
 * Returns a short text summary of the current policy for system prompt injection.
 * Intentionally terse to minimize context usage.
 */
export function getPolicySummary(policy: ZoraPolicy): string {
  const fsPolicy = policy.filesystem;
  const sh = policy.shell;
  const lines: string[] = [];

  if (fsPolicy.allowed_paths.length === 0) {
    lines.push('Filesystem: LOCKED (no paths allowed)');
  } else {
    lines.push(`Filesystem: ${fsPolicy.allowed_paths.join(', ')}`);
  }

  if (fsPolicy.denied_paths.length > 0) {
    lines.push(`Denied: ${fsPolicy.denied_paths.join(', ')}`);
  }

  if (sh.mode === 'deny_all') {
    lines.push('Shell: DISABLED (no commands allowed)');
  } else if (sh.mode === 'allowlist') {
    lines.push(`Shell: ${sh.allowed_commands.join(', ')}`);
  } else {
    lines.push('Shell: denylist mode');
  }

  if (policy.budget) {
    const b = policy.budget;
    lines.push(`Budget: ${b.max_actions_per_session || 'unlimited'} actions/session, ${b.token_budget || 'unlimited'} tokens`);
  }

  if (policy.dry_run?.enabled) {
    lines.push('Dry Run: ENABLED (write operations will be previewed only)');
  }

  return lines.join('\n');
}

/**
 * Writes the policy state to a TOML file.
 * Builds TOML manually for simplicity (avoids needing smol-toml at runtime).
 */
export function writePolicyFile(policy: ZoraPolicy, filePath: string): void {
  try {
    // Build TOML manually for simplicity (avoids needing smol-toml at runtime here)
    const lines: string[] = [
      '# Zora Security Policy — auto-generated (runtime expansion applied)',
      '',
      '[filesystem]',
      `allowed_paths = ${JSON.stringify(policy.filesystem.allowed_paths)}`,
      `denied_paths = ${JSON.stringify(policy.filesystem.denied_paths)}`,
      `resolve_symlinks = ${policy.filesystem.resolve_symlinks}`,
      `follow_symlinks = ${policy.filesystem.follow_symlinks}`,
      '',
      '[shell]',
      `mode = "${policy.shell.mode}"`,
      `allowed_commands = ${JSON.stringify(policy.shell.allowed_commands)}`,
      `denied_commands = ${JSON.stringify(policy.shell.denied_commands)}`,
      `split_chained_commands = ${policy.shell.split_chained_commands}`,
      `max_execution_time = "${policy.shell.max_execution_time}"`,
      '',
      '[actions]',
      `reversible = ${JSON.stringify(policy.actions.reversible)}`,
      `irreversible = ${JSON.stringify(policy.actions.irreversible)}`,
      `always_flag = ${JSON.stringify(policy.actions.always_flag)}`,
      '',
      '[network]',
      `allowed_domains = ${JSON.stringify(policy.network.allowed_domains)}`,
      `denied_domains = ${JSON.stringify(policy.network.denied_domains)}`,
      `max_request_size = "${policy.network.max_request_size}"`,
      '',
    ];

    // Serialize budget section if present
    if (policy.budget) {
      const b = policy.budget;
      lines.push(
        '[budget]',
        `max_actions_per_session = ${b.max_actions_per_session}`,
        `token_budget = ${b.token_budget}`,
        `on_exceed = "${b.on_exceed}"`,
        '',
        '[budget.max_actions_per_type]',
      );
      for (const [type, limit] of Object.entries(b.max_actions_per_type)) {
        lines.push(`${type} = ${limit}`);
      }
      lines.push('');
    }

    // Serialize dry_run section if present
    if (policy.dry_run) {
      const dr = policy.dry_run;
      lines.push(
        '[dry_run]',
        `enabled = ${dr.enabled}`,
        `tools = ${JSON.stringify(dr.tools)}`,
        `audit_dry_runs = ${dr.audit_dry_runs}`,
        '',
      );
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to persist policy expansion');
  }
}
