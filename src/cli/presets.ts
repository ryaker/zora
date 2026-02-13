/**
 * Policy Presets — Safe, Balanced, Power.
 *
 * These match the spec presets in specs/v5/docs/POLICY_PRESETS.md.
 * Used by `zora init` to generate policy.toml.
 */

import type { ZoraPolicy } from '../types.js';

export type PresetName = 'safe' | 'balanced' | 'power';

export const PRESETS: Record<PresetName, ZoraPolicy> = {
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
  safe: 'Read-only, no shell — best for first run or high-sensitivity environments',
  balanced: 'Read/write inside dev path plus safe shell allowlist (recommended)',
  power: 'Expanded filesystem + shell access — use only if you understand the risks',
};
