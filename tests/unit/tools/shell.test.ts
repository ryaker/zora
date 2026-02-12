import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShellTools } from '../../../src/tools/shell.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { ZoraPolicy } from '../../../src/types.js';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

describe('ShellTools', () => {
  let engine: PolicyEngine;
  let tools: ShellTools;
  const policy: ZoraPolicy = {
    filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['npm', 'ls'],
      denied_commands: ['rm'],
      split_chained_commands: true,
      max_execution_time: '1m',
    },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    engine = new PolicyEngine(policy);
    tools = new ShellTools(engine);
  });

  it('executes allowed command', () => {
    vi.mocked(execSync).mockReturnValue('v20.0.0');
    const result = tools.execute('npm --version');
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('v20.0.0');
  });

  it('denies forbidden command', () => {
    const result = tools.execute('rm -rf /');
    expect(result.success).toBe(false);
    expect(result.error).toContain('forbidden');
  });

  it('denies command not in allowlist', () => {
    const result = tools.execute('curl example.com');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in the allowlist');
  });

  it('handles execution error', () => {
    const error = new Error('Command failed');
    (error as any).status = 1;
    (error as any).stdout = 'some output';
    (error as any).stderr = 'error detail';
    vi.mocked(execSync).mockImplementation(() => { throw error; });

    const result = tools.execute('npm test');
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('some output');
    expect(result.stderr).toBe('error detail');
  });
});
