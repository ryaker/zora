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

    it('handles escaped quotes inside double-quoted strings', () => {
      const result = engine.validateCommand('ls "foo \\"bar\\" baz"');
      expect(result.allowed).toBe(true);
    });

    it('handles single quotes inside double-quoted strings', () => {
      const result = engine.validateCommand('ls "foo \'bar\' baz"');
      expect(result.allowed).toBe(true);
    });

    it('handles empty string arguments', () => {
      const result = engine.validateCommand('ls ""');
      expect(result.allowed).toBe(true);
    });

    it('handles backslash escaping outside quotes', () => {
      const result = engine.validateCommand('ls foo\\ bar');
      expect(result.allowed).toBe(true);
    });

    it('detects injection with backtick command substitution', () => {
      const result = engine.validateCommand('ls `rm -rf /`');
      // ls is allowed, the backticks are just arguments
      expect(result.allowed).toBe(true);
    });

    it('detects injection with $() command substitution in chained commands', () => {
      // The semicolon should split this into two commands
      const result = engine.validateCommand('ls foo; sudo rm -rf /');
      expect(result.allowed).toBe(false);
    });

    it('does not split on operators inside $() substitution', () => {
      // The && inside $() should not split the command
      const result = engine.validateCommand('npm run $(echo "test && build")');
      expect(result.allowed).toBe(true);
    });

    it('handles variable assignments before commands', () => {
      policy.shell.allowed_commands = ['npm', 'ls', 'git', 'node'];
      const result = engine.validateCommand('NODE_ENV=production node app.js');
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

  it('denies Bash without command input', async () => {
    const engine = new PolicyEngine(defaultPolicy);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Bash', {}, { signal });
    expect(result.behavior).toBe('deny');
  });
});

describe('checkAccess', () => {
  const policy: ZoraPolicy = {
    filesystem: {
      allowed_paths: ['~/Projects'],
      denied_paths: ['~/.ssh'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['git', 'npm', 'ls'],
      denied_commands: ['rm', 'sudo'],
      split_chained_commands: true,
      max_execution_time: '1m',
    },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
  };

  it('returns allowed/denied status for multiple paths', () => {
    const engine = new PolicyEngine(policy);
    const result = engine.checkAccess(['~/Projects/app', '~/Downloads', '~/.ssh'], []);

    expect(result.paths['~/Projects/app']!.allowed).toBe(true);
    expect(result.paths['~/Downloads']!.allowed).toBe(false);
    expect(result.paths['~/.ssh']!.allowed).toBe(false);
    expect(result.paths['~/.ssh']!.reason).toContain('denied');
  });

  it('returns allowed/denied status for multiple commands', () => {
    const engine = new PolicyEngine(policy);
    const result = engine.checkAccess([], ['git status', 'rm -rf /']);

    expect(result.commands['git status']!.allowed).toBe(true);
    expect(result.commands['rm -rf /']!.allowed).toBe(false);
  });

  it('includes suggestion when any resource is denied', () => {
    const engine = new PolicyEngine(policy);
    const result = engine.checkAccess(['~/Downloads'], []);

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('policy.toml');
  });

  it('omits suggestion when all resources are allowed', () => {
    const engine = new PolicyEngine(policy);
    const result = engine.checkAccess(['~/Projects/app'], ['git status']);

    expect(result.suggestion).toBeUndefined();
  });

  it('handles empty inputs', () => {
    const engine = new PolicyEngine(policy);
    const result = engine.checkAccess([], []);

    expect(Object.keys(result.paths)).toHaveLength(0);
    expect(Object.keys(result.commands)).toHaveLength(0);
    expect(result.suggestion).toBeUndefined();
  });
});

describe('getPolicySummary', () => {
  it('includes allowed paths and shell info', () => {
    const engine = new PolicyEngine({
      filesystem: {
        allowed_paths: ['~/Projects', '~/.zora/workspace'],
        denied_paths: ['~/.ssh'],
        resolve_symlinks: true,
        follow_symlinks: false,
      },
      shell: {
        mode: 'allowlist',
        allowed_commands: ['git', 'npm'],
        denied_commands: [],
        split_chained_commands: true,
        max_execution_time: '1m',
      },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    });

    const summary = engine.getPolicySummary();
    expect(summary).toContain('~/Projects');
    expect(summary).toContain('~/.ssh');
    expect(summary).toContain('git');
  });

  it('shows LOCKED for empty allowed_paths', () => {
    const engine = new PolicyEngine({
      filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    });

    const summary = engine.getPolicySummary();
    expect(summary).toContain('LOCKED');
    expect(summary).toContain('DISABLED');
  });
});

describe('always_flag enforcement', () => {
  const flagPolicy: ZoraPolicy = {
    filesystem: {
      allowed_paths: ['/home/user'],
      denied_paths: [],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['git', 'ls'],
      denied_commands: [],
      split_chained_commands: true,
      max_execution_time: '1m',
    },
    actions: {
      reversible: ['write_file'],
      irreversible: ['git_push'],
      always_flag: ['git_push'],
    },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
  };

  const signal = new AbortController().signal;

  it('calls flagCallback when always_flag matches git push', async () => {
    const flagCallback = vi.fn().mockResolvedValue(true);
    const engine = new PolicyEngine(flagPolicy, flagCallback);
    const canUseTool = engine.createCanUseTool();

    await canUseTool('Bash', { command: 'git push origin main' }, { signal });
    expect(flagCallback).toHaveBeenCalledWith('git_push', expect.stringContaining('git push'));
  });

  it('denies when flagCallback returns false', async () => {
    const flagCallback = vi.fn().mockResolvedValue(false);
    const engine = new PolicyEngine(flagPolicy, flagCallback);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Bash', { command: 'git push' }, { signal });
    expect(result.behavior).toBe('deny');
  });

  it('allows when flagCallback returns true', async () => {
    const flagCallback = vi.fn().mockResolvedValue(true);
    const engine = new PolicyEngine(flagPolicy, flagCallback);
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Bash', { command: 'git push' }, { signal });
    expect(result.behavior).toBe('allow');
  });

  it('does not flag actions not in always_flag list', async () => {
    const flagCallback = vi.fn().mockResolvedValue(true);
    const engine = new PolicyEngine(flagPolicy, flagCallback);
    const canUseTool = engine.createCanUseTool();

    await canUseTool('Bash', { command: 'git status' }, { signal });
    expect(flagCallback).not.toHaveBeenCalled();
  });

  it('allows without callback when always_flag is configured but no callback set', async () => {
    const engine = new PolicyEngine(flagPolicy); // no callback
    const canUseTool = engine.createCanUseTool();

    const result = await canUseTool('Bash', { command: 'git push' }, { signal });
    expect(result.behavior).toBe('allow');
  });

  it('flags all actions when always_flag includes wildcard', async () => {
    const wildcardPolicy = {
      ...flagPolicy,
      actions: { ...flagPolicy.actions, always_flag: ['*'] },
    };
    const flagCallback = vi.fn().mockResolvedValue(true);
    const engine = new PolicyEngine(wildcardPolicy, flagCallback);
    const canUseTool = engine.createCanUseTool();

    await canUseTool('Bash', { command: 'ls -la' }, { signal });
    expect(flagCallback).toHaveBeenCalledWith('shell_exec', expect.any(String));
  });

  it('supports setFlagCallback to add callback after construction', async () => {
    const engine = new PolicyEngine(flagPolicy);
    const flagCallback = vi.fn().mockResolvedValue(false);
    engine.setFlagCallback(flagCallback);

    const canUseTool = engine.createCanUseTool();
    const result = await canUseTool('Bash', { command: 'git push' }, { signal });
    expect(result.behavior).toBe('deny');
    expect(flagCallback).toHaveBeenCalled();
  });
});

describe('policy getter', () => {
  it('exposes the policy object', () => {
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: ['~/Dev'], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: ['ls'], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);
    expect(engine.policy).toBe(policy);
  });
});

describe('expandPolicy', () => {
  it('adds new paths to allowed_paths', () => {
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: ['~/Projects'], denied_paths: ['~/.ssh'], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: ['git'], denied_commands: ['rm'], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);

    engine.expandPolicy({ paths: ['~/Downloads'] });

    expect(engine.policy.filesystem.allowed_paths).toContain('~/Downloads');
    expect(engine.policy.filesystem.allowed_paths).toContain('~/Projects');
  });

  it('adds new commands to allowed_commands', () => {
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: ['git'], denied_commands: ['rm'], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);

    engine.expandPolicy({ commands: ['curl', 'wget'] });

    expect(engine.policy.shell.allowed_commands).toContain('curl');
    expect(engine.policy.shell.allowed_commands).toContain('wget');
    expect(engine.policy.shell.allowed_commands).toContain('git');
  });

  it('throws when trying to grant access to a permanently denied path', () => {
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: ['~/Projects'], denied_paths: ['~/.ssh'], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);

    expect(() => engine.expandPolicy({ paths: ['~/.ssh/keys'] })).toThrow('permanently denied');
  });

  it('throws when trying to allow a permanently denied command', () => {
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: [], denied_commands: ['rm'], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);

    expect(() => engine.expandPolicy({ commands: ['rm'] })).toThrow('permanently denied');
  });

  it('deduplicates when expanding with already-allowed paths', () => {
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: ['~/Projects'], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);

    engine.expandPolicy({ paths: ['~/Projects', '~/Downloads'] });

    const count = engine.policy.filesystem.allowed_paths.filter(p => p === '~/Projects').length;
    expect(count).toBe(1);
    expect(engine.policy.filesystem.allowed_paths).toHaveLength(2);
  });

  it('switches shell mode from deny_all to allowlist when commands are added', () => {
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);

    engine.expandPolicy({ commands: ['ls'] });

    expect(engine.policy.shell.mode).toBe('allowlist');
    expect(engine.policy.shell.allowed_commands).toContain('ls');
  });

  it('persists changes to file when policyFilePath is set', () => {
    const tmpFile = path.join(os.tmpdir(), `zora-policy-test-${Date.now()}.toml`);
    const policy: ZoraPolicy = {
      filesystem: { allowed_paths: ['~/Projects'], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: ['git'], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
    };
    const engine = new PolicyEngine(policy);
    engine.setPolicyFilePath(tmpFile);

    engine.expandPolicy({ paths: ['~/Downloads'] });

    expect(fs.existsSync(tmpFile)).toBe(true);
    const content = fs.readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('~/Downloads');
    expect(content).toContain('~/Projects');

    // Cleanup
    fs.unlinkSync(tmpFile);
  });
});
