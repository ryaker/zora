import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import type { ZoraPolicy } from '../../../src/types.js';
import fs from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    lstatSync: vi.fn(),
    realpathSync: vi.fn(),
  };
});

describe('Action Budget Enforcement', () => {
  const basePolicy: ZoraPolicy = {
    filesystem: {
      allowed_paths: ['/tmp/test'],
      denied_paths: [],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['ls', 'git', 'npm'],
      denied_commands: [],
      split_chained_commands: true,
      max_execution_time: '1m',
    },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
  };

  describe('recordAction', () => {
    it('allows actions when no budget is configured', () => {
      const engine = new PolicyEngine(basePolicy);
      for (let i = 0; i < 1000; i++) {
        expect(engine.recordAction('shell_exec').allowed).toBe(true);
      }
    });

    it('blocks after max_actions_per_session is exceeded', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 3,
          max_actions_per_type: {},
          token_budget: 0,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');

      expect(engine.recordAction('shell_exec').allowed).toBe(true);
      expect(engine.recordAction('write_file').allowed).toBe(true);
      expect(engine.recordAction('edit_file').allowed).toBe(true);

      // 4th action should be blocked
      const result = engine.recordAction('shell_exec');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Session action budget exceeded');
      expect(result.reason).toContain('4/3');
    });

    it('blocks only the exceeded action type, not others', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 0, // unlimited total
          max_actions_per_type: { shell_exec: 2, write_file: 100 },
          token_budget: 0,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');

      expect(engine.recordAction('shell_exec').allowed).toBe(true);
      expect(engine.recordAction('shell_exec').allowed).toBe(true);

      // 3rd shell_exec should be blocked
      const result = engine.recordAction('shell_exec');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Action type 'shell_exec' budget exceeded");

      // write_file should still be allowed
      expect(engine.recordAction('write_file').allowed).toBe(true);
    });

    it('does not enforce on types without a limit', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 0,
          max_actions_per_type: { shell_exec: 2 },
          token_budget: 0,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');

      // edit_file has no limit configured
      for (let i = 0; i < 100; i++) {
        expect(engine.recordAction('edit_file').allowed).toBe(true);
      }
    });
  });

  describe('recordTokenUsage', () => {
    it('allows tokens when no budget is configured', () => {
      const engine = new PolicyEngine(basePolicy);
      expect(engine.recordTokenUsage(999999).allowed).toBe(true);
    });

    it('blocks after token_budget is exceeded', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 0,
          max_actions_per_type: {},
          token_budget: 1000,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');

      expect(engine.recordTokenUsage(500).allowed).toBe(true);
      expect(engine.recordTokenUsage(400).allowed).toBe(true);

      // 101 more tokens exceeds 1000
      const result = engine.recordTokenUsage(101);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Token budget exceeded');
      expect(result.reason).toContain('1001/1000');
    });

    it('token_budget 0 means unlimited', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 0,
          max_actions_per_type: {},
          token_budget: 0,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      expect(engine.recordTokenUsage(999999999).allowed).toBe(true);
    });
  });

  describe('getBudgetStatus', () => {
    it('returns accurate counts', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 100,
          max_actions_per_type: { shell_exec: 50 },
          token_budget: 10000,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');

      engine.recordAction('shell_exec');
      engine.recordAction('shell_exec');
      engine.recordAction('write_file');
      engine.recordTokenUsage(500);

      const status = engine.getBudgetStatus();
      expect(status.totalActionsUsed).toBe(3);
      expect(status.totalActionsLimit).toBe(100);
      expect(status.tokensUsed).toBe(500);
      expect(status.tokenLimit).toBe(10000);
      expect(status.exceeded).toBe(false);
      expect(status.exceededCategories).toEqual([]);
      expect(status.actionsPerType['shell_exec']).toEqual({ used: 2, limit: 50 });
      expect(status.actionsPerType['write_file']).toEqual({ used: 1, limit: 0 });
    });

    it('reports exceeded categories', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 2,
          max_actions_per_type: {},
          token_budget: 0,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');

      engine.recordAction('shell_exec');
      engine.recordAction('shell_exec');
      engine.recordAction('shell_exec'); // exceeds

      const status = engine.getBudgetStatus();
      expect(status.exceeded).toBe(true);
      expect(status.exceededCategories).toContain('total_actions');
    });
  });

  describe('resetBudget', () => {
    it('clears all counters', () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 5,
          max_actions_per_type: {},
          token_budget: 1000,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');

      engine.recordAction('shell_exec');
      engine.recordAction('shell_exec');
      engine.recordTokenUsage(800);

      engine.resetBudget();

      const status = engine.getBudgetStatus();
      expect(status.totalActionsUsed).toBe(0);
      expect(status.tokensUsed).toBe(0);
    });
  });

  describe('createCanUseTool with budget', () => {
    it('enforces budget in canUseTool callback', async () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 2,
          max_actions_per_type: {},
          token_budget: 0,
          on_exceed: 'block',
        },
      };
      const engine = new PolicyEngine(policy);
      engine.startSession('test');
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      // First two calls should succeed
      const r1 = await canUseTool('Write', { file_path: '/tmp/test/a.txt' }, { signal });
      expect(r1.behavior).toBe('allow');
      const r2 = await canUseTool('Write', { file_path: '/tmp/test/b.txt' }, { signal });
      expect(r2.behavior).toBe('allow');

      // Third call should be denied by budget
      const r3 = await canUseTool('Write', { file_path: '/tmp/test/c.txt' }, { signal });
      expect(r3.behavior).toBe('deny');
      if (r3.behavior === 'deny') {
        expect(r3.message).toContain('budget exceeded');
      }
    });

    it('uses flag callback when on_exceed is flag', async () => {
      const flagCb = vi.fn().mockResolvedValue(true); // approve
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 1,
          max_actions_per_type: {},
          token_budget: 0,
          on_exceed: 'flag',
        },
      };
      const engine = new PolicyEngine(policy, flagCb);
      engine.startSession('test');
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      await canUseTool('Write', { file_path: '/tmp/test/a.txt' }, { signal });
      const r2 = await canUseTool('Write', { file_path: '/tmp/test/b.txt' }, { signal });

      // Should have called flag callback
      expect(flagCb).toHaveBeenCalledWith('budget_exceeded', expect.stringContaining('budget exceeded'));
      // But allowed because callback returned true
      expect(r2.behavior).toBe('allow');
    });

    it('denies when flag callback rejects', async () => {
      const flagCb = vi.fn().mockResolvedValue(false); // deny
      const policy: ZoraPolicy = {
        ...basePolicy,
        budget: {
          max_actions_per_session: 1,
          max_actions_per_type: {},
          token_budget: 0,
          on_exceed: 'flag',
        },
      };
      const engine = new PolicyEngine(policy, flagCb);
      engine.startSession('test');
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      await canUseTool('Write', { file_path: '/tmp/test/a.txt' }, { signal });
      const r2 = await canUseTool('Write', { file_path: '/tmp/test/b.txt' }, { signal });

      expect(r2.behavior).toBe('deny');
    });
  });
});
