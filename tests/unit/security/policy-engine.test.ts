import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import type { ZoraPolicy } from '../../../src/types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    lstatSync: vi.fn(),
    realpathSync: vi.fn(),
  };
});

describe('PolicyEngine', () => {
  let policy: ZoraPolicy;
  let engine: PolicyEngine;
  const home = os.homedir();

  beforeEach(() => {
    vi.resetAllMocks();
    policy = {
      filesystem: {
        allowed_paths: ['~/Projects', '/tmp/zora'],
        denied_paths: ['~/.ssh', '/tmp/zora/secret'],
        resolve_symlinks: true,
        follow_symlinks: false,
      },
      shell: {
        mode: 'allowlist',
        allowed_commands: ['npm', 'ls', 'git'],
        denied_commands: ['sudo', 'rm'],
        split_chained_commands: true,
        max_execution_time: '1m',
      },
      actions: {
        reversible: [],
        irreversible: [],
        always_flag: [],
      },
      network: {
        allowed_domains: [],
        denied_domains: [],
        max_request_size: '1mb',
      },
    };
    engine = new PolicyEngine(policy);
  });

  describe('validatePath', () => {
    it('allows access to subdirectories of allowed paths', () => {
      const result = engine.validatePath('~/Projects/my-app');
      expect(result.allowed).toBe(true);
      expect(result.resolvedPath).toBe(path.join(home, 'Projects/my-app'));
    });

    it('denies access to paths outside allowlist', () => {
      const result = engine.validatePath('/etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not permitted');
    });

    it('denies access to paths in denylist (even if under allowlist)', () => {
      const result = engine.validatePath('~/.ssh/id_rsa');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly denied');
    });

    it('denies access to subdirectories of denied paths', () => {
      const result = engine.validatePath('/tmp/zora/secret/keys.json');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly denied');
    });

    it('handles symlink checks correctly when follow_symlinks is false', () => {
      const symlinkPath = path.join(home, 'Projects/link');
      const targetPath = '/etc/passwd';

      vi.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => true } as any);
      vi.spyOn(fs, 'realpathSync').mockReturnValue(targetPath);

      const result = engine.validatePath(symlinkPath);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Symlink target');
    });
  });

  describe('validateCommand', () => {
    it('allows commands in the allowlist', () => {
      const result = engine.validateCommand('npm install');
      expect(result.allowed).toBe(true);
    });

    it('denies commands not in the allowlist', () => {
      const result = engine.validateCommand('curl google.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in the allowlist');
    });

    it('denies all commands in deny_all mode', () => {
      policy.shell.mode = 'deny_all';
      const result = engine.validateCommand('ls');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled by security policy');
    });

    it('denies explicitly forbidden commands', () => {
      const result = engine.validateCommand('sudo su');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly forbidden');
    });

    it('validates chained commands correctly', () => {
      const result = engine.validateCommand('npm test && rm -rf /');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("'rm' is explicitly forbidden");
    });

    it('allows separators inside quoted strings', () => {
      const result = engine.validateCommand('ls "foo; bar"');
      expect(result.allowed).toBe(true);
    });

    it('denies injection after quoted strings', () => {
      const result = engine.validateCommand('ls "foo"; rm -rf /');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("'rm' is explicitly forbidden");
    });

    it('extracts base command from paths', () => {
      const result = engine.validateCommand('/usr/bin/git commit');
      expect(result.allowed).toBe(true);
    });
  });
});

describe('createCanUseTool', () => {
  const defaultPolicy: ZoraPolicy = {
    filesystem: {
      allowed_paths: ['/home/user'],
      denied_paths: ['/home/user/secrets'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['ls', 'npm', 'git'],
      denied_commands: ['rm'],
      split_chained_commands: true,
      max_execution_time: '1m',
    },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
  };

  const signal = new AbortController().signal;

  it('allows Bash with permitted command', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Bash', { command: 'ls -la' }, { signal });
    expect(result.behavior).toBe('allow');
  });

  it('denies Bash with forbidden command', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Bash', { command: 'rm -rf /' }, { signal });
    expect(result.behavior).toBe('deny');
  });

  it('allows Read with permitted path', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Read', { file_path: '/home/user/file.txt' }, { signal });
    expect(result.behavior).toBe('allow');
  });

  it('denies Write to denied path', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Write', { file_path: '/home/user/secrets/key.pem' }, { signal });
    expect(result.behavior).toBe('deny');
  });

  it('denies Edit to path outside allowed boundaries', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Edit', { file_path: '/etc/passwd' }, { signal });
    expect(result.behavior).toBe('deny');
  });

  it('allows Glob with permitted path', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Glob', { pattern: '**/*.ts', path: '/home/user/project' }, { signal });
    expect(result.behavior).toBe('allow');
  });

  it('denies Grep with denied path', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Grep', { pattern: 'secret', path: '/home/user/secrets' }, { signal });
    expect(result.behavior).toBe('deny');
  });

  it('allows unknown tools by default', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('WebSearch', { query: 'test' }, { signal });
    expect(result.behavior).toBe('allow');
  });

  it('allows Bash without command input', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Bash', {}, { signal });
    expect(result.behavior).toBe('allow');
  });
});
