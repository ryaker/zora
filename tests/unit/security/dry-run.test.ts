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

describe('Dry Run Mode', () => {
  const basePolicy: ZoraPolicy = {
    filesystem: {
      allowed_paths: ['/tmp/test'],
      denied_paths: [],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['ls', 'git', 'npm', 'node'],
      denied_commands: [],
      split_chained_commands: true,
      max_execution_time: '1m',
    },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
  };

  describe('dry-run disabled', () => {
    it('allows write operations normally when dry_run is not set', async () => {
      const engine = new PolicyEngine(basePolicy);
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      const r = await canUseTool('Write', { file_path: '/tmp/test/file.txt' }, { signal });
      expect(r.behavior).toBe('allow');
    });

    it('allows write operations when dry_run.enabled is false', async () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        dry_run: { enabled: false, tools: [], audit_dry_runs: true },
      };
      const engine = new PolicyEngine(policy);
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      const r = await canUseTool('Write', { file_path: '/tmp/test/file.txt' }, { signal });
      expect(r.behavior).toBe('allow');
    });
  });

  describe('dry-run enabled globally', () => {
    let engine: PolicyEngine;
    let canUseTool: ReturnType<PolicyEngine['createCanUseTool']>;
    const signal = new AbortController().signal;

    beforeEach(() => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        dry_run: { enabled: true, tools: [], audit_dry_runs: true },
      };
      engine = new PolicyEngine(policy);
      canUseTool = engine.createCanUseTool();
    });

    it('intercepts Write tool', async () => {
      const r = await canUseTool('Write', { file_path: '/tmp/test/file.txt' }, { signal });
      expect(r.behavior).toBe('deny');
      if (r.behavior === 'deny') {
        expect(r.message).toContain('[DRY RUN]');
        expect(r.message).toContain('Would write to file');
      }
    });

    it('intercepts Edit tool', async () => {
      const r = await canUseTool('Edit', { file_path: '/tmp/test/file.txt', old_string: 'a', new_string: 'b' }, { signal });
      expect(r.behavior).toBe('deny');
      if (r.behavior === 'deny') {
        expect(r.message).toContain('[DRY RUN]');
        expect(r.message).toContain('Would edit file');
      }
    });

    it('intercepts non-read-only Bash commands', async () => {
      const r = await canUseTool('Bash', { command: 'npm install' }, { signal });
      expect(r.behavior).toBe('deny');
      if (r.behavior === 'deny') {
        expect(r.message).toContain('[DRY RUN]');
        expect(r.message).toContain('Would execute shell command');
      }
    });

    it('does NOT intercept read-only Bash commands', async () => {
      const r = await canUseTool('Bash', { command: 'ls -la' }, { signal });
      expect(r.behavior).toBe('allow');
    });

    it('does NOT intercept git status', async () => {
      const r = await canUseTool('Bash', { command: 'git status' }, { signal });
      expect(r.behavior).toBe('allow');
    });

    it('does NOT intercept git diff', async () => {
      const r = await canUseTool('Bash', { command: 'git diff HEAD' }, { signal });
      expect(r.behavior).toBe('allow');
    });

    it('does NOT intercept Read tool', async () => {
      const r = await canUseTool('Read', { file_path: '/tmp/test/file.txt' }, { signal });
      expect(r.behavior).toBe('allow');
    });

    it('does NOT intercept Glob tool', async () => {
      const r = await canUseTool('Glob', { path: '/tmp/test', pattern: '*.ts' }, { signal });
      expect(r.behavior).toBe('allow');
    });

    it('intercepts chained commands where any part is not read-only', async () => {
      // "ls && rm -rf /tmp" should NOT be treated as read-only
      const r = await canUseTool('Bash', { command: 'ls && npm install' }, { signal });
      expect(r.behavior).toBe('deny');
      if (r.behavior === 'deny') {
        expect(r.message).toContain('[DRY RUN]');
      }
    });

    it('allows chained commands where ALL parts are read-only', async () => {
      const r = await canUseTool('Bash', { command: 'ls -la && git status' }, { signal });
      expect(r.behavior).toBe('allow');
    });

    it('intercepts piped commands where any part is not read-only', async () => {
      const r = await canUseTool('Bash', { command: 'ls | npm install' }, { signal });
      expect(r.behavior).toBe('deny');
      if (r.behavior === 'deny') {
        expect(r.message).toContain('[DRY RUN]');
      }
    });
  });

  describe('dry-run with specific tools', () => {
    it('only intercepts listed tools', async () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        dry_run: { enabled: true, tools: ['Write'], audit_dry_runs: true },
      };
      const engine = new PolicyEngine(policy);
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      // Write should be intercepted
      const r1 = await canUseTool('Write', { file_path: '/tmp/test/file.txt' }, { signal });
      expect(r1.behavior).toBe('deny');

      // Edit should pass through (not in tools list)
      const r2 = await canUseTool('Edit', { file_path: '/tmp/test/file.txt', old_string: 'a', new_string: 'b' }, { signal });
      expect(r2.behavior).toBe('allow');

      // Bash should pass through
      const r3 = await canUseTool('Bash', { command: 'npm install' }, { signal });
      expect(r3.behavior).toBe('allow');
    });
  });

  describe('getDryRunLog', () => {
    it('accumulates intercepted entries', async () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        dry_run: { enabled: true, tools: [], audit_dry_runs: false },
      };
      const engine = new PolicyEngine(policy);
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      await canUseTool('Write', { file_path: '/tmp/test/a.txt' }, { signal });
      await canUseTool('Edit', { file_path: '/tmp/test/b.txt', old_string: 'a', new_string: 'b' }, { signal });
      // Read should not appear in log
      await canUseTool('Read', { file_path: '/tmp/test/c.txt' }, { signal });

      const log = engine.getDryRunLog();
      expect(log).toHaveLength(2);
      expect(log[0]!.toolName).toBe('Write');
      expect(log[0]!.intercepted).toBe(true);
      expect(log[1]!.toolName).toBe('Edit');
    });

    it('returns a copy (not the internal array)', async () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        dry_run: { enabled: true, tools: [], audit_dry_runs: false },
      };
      const engine = new PolicyEngine(policy);
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      await canUseTool('Write', { file_path: '/tmp/test/a.txt' }, { signal });
      const log1 = engine.getDryRunLog();
      log1.pop(); // mutate the copy
      expect(engine.getDryRunLog()).toHaveLength(1); // original unaffected
    });
  });

  describe('clearDryRunLog', () => {
    it('resets the log', async () => {
      const policy: ZoraPolicy = {
        ...basePolicy,
        dry_run: { enabled: true, tools: [], audit_dry_runs: false },
      };
      const engine = new PolicyEngine(policy);
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      await canUseTool('Write', { file_path: '/tmp/test/a.txt' }, { signal });
      expect(engine.getDryRunLog()).toHaveLength(1);

      engine.clearDryRunLog();
      expect(engine.getDryRunLog()).toHaveLength(0);
    });
  });

  describe('backward compatibility', () => {
    it('policy without dry_run field allows all operations', async () => {
      const engine = new PolicyEngine(basePolicy);
      const canUseTool = engine.createCanUseTool();
      const signal = new AbortController().signal;

      const r1 = await canUseTool('Write', { file_path: '/tmp/test/file.txt' }, { signal });
      expect(r1.behavior).toBe('allow');

      const r2 = await canUseTool('Bash', { command: 'npm install' }, { signal });
      expect(r2.behavior).toBe('allow');

      expect(engine.getDryRunLog()).toHaveLength(0);
    });
  });
});
