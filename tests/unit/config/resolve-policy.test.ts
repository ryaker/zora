import { describe, it, expect } from 'vitest';
import { parsePolicy } from '../../../src/config/policy-loader.js';
import { deepMerge } from '../../../src/config/loader.js';
import type { ZoraPolicy } from '../../../src/types.js';

/**
 * Tests for resolvePolicy() — two-layer policy resolution:
 *   global ~/.zora/policy.toml → project .zora/policy.toml
 *
 * Since resolvePolicy() depends on os.homedir(), we test the merge
 * behavior via parsePolicy() + deepMerge() directly.
 */

const GLOBAL_POLICY_RAW = {
  filesystem: {
    allowed_paths: ['~/Dev', '~/.zora'],
    denied_paths: ['~/.ssh', '~/.gnupg', '~/.aws'],
    resolve_symlinks: true,
    follow_symlinks: false,
  },
  shell: {
    mode: 'allowlist',
    allowed_commands: ['ls', 'npm', 'git', 'node'],
    denied_commands: [],
    split_chained_commands: true,
    max_execution_time: '1m',
  },
  actions: {
    reversible: ['file_write', 'file_create'],
    irreversible: ['file_delete'],
    always_flag: ['shell_exec'],
  },
  network: {
    allowed_domains: ['api.anthropic.com', 'generativelanguage.googleapis.com'],
    denied_domains: [],
    max_request_size: '10mb',
  },
};

const PROJECT_POLICY_RAW = {
  filesystem: {
    allowed_paths: ['~/Dev/my-project'],
  },
  shell: {
    allowed_commands: ['ls', 'npm', 'git', 'node', 'python3', 'pip'],
  },
};

describe('policy merge behavior', () => {
  it('parses global policy with all defaults', () => {
    const policy = parsePolicy(GLOBAL_POLICY_RAW);
    expect(policy.filesystem.allowed_paths).toContain('~/Dev');
    expect(policy.shell.mode).toBe('allowlist');
    expect(policy.shell.allowed_commands).toContain('git');
  });

  it('project policy overrides global arrays (replace, not merge)', () => {
    const globalPolicy = parsePolicy(GLOBAL_POLICY_RAW);

    // resolvePolicy merges RAW project data (not parsed) over the parsed global.
    // This ensures only explicit project fields override global values.
    const merged = deepMerge(
      globalPolicy as unknown as Record<string, unknown>,
      PROJECT_POLICY_RAW,
    ) as unknown as ZoraPolicy;

    // Project replaces filesystem.allowed_paths
    expect(merged.filesystem.allowed_paths).toEqual(['~/Dev/my-project']);

    // Project replaces shell.allowed_commands
    expect(merged.shell.allowed_commands).toContain('python3');
    expect(merged.shell.allowed_commands).toContain('pip');

    // Global fields not overridden are preserved
    expect(merged.filesystem.denied_paths).toContain('~/.ssh');
    expect(merged.shell.mode).toBe('allowlist');
    expect(merged.network.allowed_domains).toContain('api.anthropic.com');
    expect(merged.actions.irreversible).toContain('file_delete');
  });

  it('project can add budget policy not in global', () => {
    const globalPolicy = parsePolicy(GLOBAL_POLICY_RAW);

    // Merge raw budget data (as resolvePolicy does)
    const projectBudgetRaw = {
      budget: {
        max_actions_per_session: 50,
        max_actions_per_type: {},
        token_budget: 100000,
        on_exceed: 'flag',
      },
    };

    const merged = deepMerge(
      globalPolicy as unknown as Record<string, unknown>,
      projectBudgetRaw,
    ) as unknown as ZoraPolicy;

    expect(merged.budget).toBeDefined();
    expect(merged.budget!.max_actions_per_session).toBe(50);
    expect(merged.budget!.on_exceed).toBe('flag');

    // Global sections still present
    expect(merged.filesystem.allowed_paths).toContain('~/Dev');
  });

  it('empty project policy preserves all global settings', () => {
    const globalPolicy = parsePolicy(GLOBAL_POLICY_RAW);

    // Empty raw project data (no fields set at all)
    const merged = deepMerge(
      globalPolicy as unknown as Record<string, unknown>,
      {},
    ) as unknown as ZoraPolicy;

    // Everything should match global
    expect(merged.filesystem.allowed_paths).toEqual(globalPolicy.filesystem.allowed_paths);
    expect(merged.shell.allowed_commands).toEqual(globalPolicy.shell.allowed_commands);
    expect(merged.network.allowed_domains).toEqual(globalPolicy.network.allowed_domains);
  });

  it('project can override shell mode', () => {
    const globalPolicy = parsePolicy(GLOBAL_POLICY_RAW);

    // Raw project data — only sets shell.mode
    const merged = deepMerge(
      globalPolicy as unknown as Record<string, unknown>,
      { shell: { mode: 'deny_all' } },
    ) as unknown as ZoraPolicy;

    expect(merged.shell.mode).toBe('deny_all');
    // Other shell fields preserved from global (deep merge of nested objects)
    expect(merged.shell.split_chained_commands).toBe(true);
  });
});
