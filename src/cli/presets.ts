/**
 * Policy Presets — Safe, Balanced, Power.
 *
 * These match the spec presets in specs/v5/docs/POLICY_PRESETS.md.
 * Used by `zora-agent init` to generate policy.toml.
 */

import type { ZoraPolicy } from '../types.js';

export type PresetName = 'locked' | 'safe' | 'balanced' | 'power';

export const PRESETS: Record<PresetName, ZoraPolicy> = {
  locked: {
    filesystem: {
      allowed_paths: [],
      denied_paths: ['/', '~/', '~/.ssh', '~/.gnupg', '~/.aws'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'deny_all',
      allowed_commands: [],
      denied_commands: ['*'],
      split_chained_commands: true,
      max_execution_time: '0s',
    },
    actions: {
      reversible: [],
      irreversible: ['*'],
      always_flag: ['*'],
    },
    network: {
      allowed_domains: [],
      denied_domains: ['*'],
      max_request_size: '0',
    },
    budget: {
      max_actions_per_session: 0,
      max_actions_per_type: {},
      token_budget: 0,
      on_exceed: 'block',
    },
    dry_run: {
      enabled: true,
      tools: [],
      audit_dry_runs: true,
    },
  },

  safe: {
    filesystem: {
      allowed_paths: ['~/Projects', '~/.zora/workspace', '~/.zora/memory/daily', '~/.zora/memory/items'],
      denied_paths: ['~/Documents', '~/Desktop', '~/Downloads', '~/Library', '~/.ssh', '~/.gnupg', '/'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'deny_all',
      allowed_commands: [],
      denied_commands: ['*'],
      split_chained_commands: true,
      max_execution_time: '1m',
    },
    actions: {
      reversible: [],
      irreversible: ['git_push', 'shell_exec_destructive'],
      always_flag: ['git_push'],
    },
    network: {
      allowed_domains: ['https://*'],
      denied_domains: [],
      max_request_size: '10mb',
    },
    budget: {
      max_actions_per_session: 100,
      max_actions_per_type: { shell_exec: 20, shell_exec_destructive: 0 },
      token_budget: 200_000,
      on_exceed: 'block',
    },
    dry_run: {
      enabled: false,
      tools: [],
      audit_dry_runs: true,
    },
  },

  balanced: {
    filesystem: {
      allowed_paths: ['~/Projects', '~/.zora/workspace', '~/.zora/memory/daily', '~/.zora/memory/items'],
      denied_paths: ['~/Documents', '~/Desktop', '~/Downloads', '~/Library', '~/.ssh', '~/.gnupg', '/'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['ls', 'pwd', 'rg', 'git', 'node', 'pnpm', 'npm'],
      denied_commands: ['sudo', 'rm', 'chmod', 'chown', 'curl', 'wget'],
      split_chained_commands: true,
      max_execution_time: '5m',
    },
    actions: {
      reversible: ['write_file', 'edit_file', 'git_commit', 'mkdir', 'cp', 'mv'],
      irreversible: ['git_push', 'shell_exec_destructive'],
      always_flag: ['git_push'],
    },
    network: {
      allowed_domains: ['https://*'],
      denied_domains: [],
      max_request_size: '10mb',
    },
    budget: {
      max_actions_per_session: 500,
      max_actions_per_type: { shell_exec: 100, write_file: 200, shell_exec_destructive: 10 },
      token_budget: 1_000_000,
      on_exceed: 'flag',
    },
    dry_run: {
      enabled: false,
      tools: [],
      audit_dry_runs: true,
    },
  },

  power: {
    filesystem: {
      allowed_paths: ['~/Projects', '~/Documents', '~/.zora/workspace', '~/.zora/memory/daily', '~/.zora/memory/items'],
      denied_paths: ['~/Library', '~/.ssh', '~/.gnupg', '/'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: [
        'ls', 'pwd', 'rg', 'git', 'node', 'pnpm', 'npm',
        'python3', 'pip', 'jq', 'yq', 'find', 'sed', 'awk',
      ],
      denied_commands: ['sudo', 'rm', 'chmod', 'chown'],
      split_chained_commands: true,
      max_execution_time: '10m',
    },
    actions: {
      reversible: ['write_file', 'edit_file', 'git_commit', 'mkdir', 'cp', 'mv'],
      irreversible: ['git_push', 'shell_exec_destructive'],
      always_flag: ['git_push'],
    },
    network: {
      allowed_domains: ['https://*'],
      denied_domains: [],
      max_request_size: '10mb',
    },
    budget: {
      max_actions_per_session: 2000,
      max_actions_per_type: { shell_exec: 500, write_file: 800, shell_exec_destructive: 50 },
      token_budget: 5_000_000,
      on_exceed: 'flag',
    },
    dry_run: {
      enabled: false,
      tools: [],
      audit_dry_runs: true,
    },
  },
};

export const TOOL_STACKS: Record<string, string[]> = {
  node: ['node', 'npm', 'npx', 'tsc', 'vitest'],
  python: ['python3', 'pip', 'pip3'],
  rust: ['cargo', 'rustc', 'rustup'],
  go: ['go'],
  general: ['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'which', 'echo', 'mkdir', 'cp', 'mv', 'touch'],
};

export const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  locked: 'Zero access — fresh install default, run `zora-agent init` to configure',
  safe: 'Read-only, no shell — best for first run or high-sensitivity environments',
  balanced: 'Read/write inside dev path plus safe shell allowlist (recommended)',
  power: 'Expanded filesystem + shell access — use only if you understand the risks',
};
