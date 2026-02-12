import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createCapabilityToken,
  enforceCapability,
  isTokenExpired,
} from '../../../src/security/capability-tokens.js';
import type { ZoraPolicy } from '../../../src/types.js';
import type { WorkerCapabilityToken } from '../../../src/types.js';

function makePolicy(): ZoraPolicy {
  return {
    filesystem: {
      allowed_paths: ['~/Projects', '/tmp/zora'],
      denied_paths: ['~/.ssh'],
      resolve_symlinks: true,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['npm', 'git', 'ls'],
      denied_commands: ['sudo', 'rm'],
      split_chained_commands: true,
      max_execution_time: '5m',
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
}

describe('createCapabilityToken', () => {
  it('creates a token with policy-derived values', () => {
    const token = createCapabilityToken('job-123', makePolicy());

    expect(token.jobId).toBe('job-123');
    expect(token.allowedPaths).toEqual(['~/Projects', '/tmp/zora']);
    expect(token.deniedPaths).toEqual(['~/.ssh']);
    expect(token.allowedCommands).toEqual(['npm', 'git', 'ls']);
    expect(token.maxExecutionTime).toBe(300_000); // 5m in ms
  });

  it('applies overrides to the token', () => {
    const token = createCapabilityToken('job-456', makePolicy(), {
      allowedPaths: ['/custom/path'],
      allowedTools: ['read_file', 'write_file'],
    });

    expect(token.allowedPaths).toEqual(['/custom/path']);
    expect(token.allowedTools).toEqual(['read_file', 'write_file']);
    expect(token.deniedPaths).toEqual(['~/.ssh']); // unchanged
  });

  it('sets createdAt and expiresAt', () => {
    const before = Date.now();
    const token = createCapabilityToken('job-789', makePolicy());
    const after = Date.now();

    expect(token.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(token.createdAt.getTime()).toBeLessThanOrEqual(after);
    expect(token.expiresAt.getTime()).toBeGreaterThan(token.createdAt.getTime());
  });
});

describe('enforceCapability', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows access to permitted paths', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    const result = enforceCapability(token, { type: 'path', target: '~/Projects/app' });
    expect(result.allowed).toBe(true);
  });

  it('denies access to denied paths', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    const result = enforceCapability(token, { type: 'path', target: '~/.ssh/id_rsa' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denied');
  });

  it('denies access to paths not in allowed list', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    const result = enforceCapability(token, { type: 'path', target: '/etc/passwd' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in token');
  });

  it('allows permitted commands', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    const result = enforceCapability(token, { type: 'command', target: 'npm install' });
    expect(result.allowed).toBe(true);
  });

  it('denies unpermitted commands', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    const result = enforceCapability(token, { type: 'command', target: 'sudo rm -rf /' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sudo');
  });

  it('allows all tools when no tools are specified', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    const result = enforceCapability(token, { type: 'tool', target: 'any_tool' });
    expect(result.allowed).toBe(true);
  });

  it('restricts tools when allowedTools is set', () => {
    const token = createCapabilityToken('job-1', makePolicy(), {
      allowedTools: ['read_file'],
    });

    const allowed = enforceCapability(token, { type: 'tool', target: 'read_file' });
    expect(allowed.allowed).toBe(true);

    const denied = enforceCapability(token, { type: 'tool', target: 'delete_file' });
    expect(denied.allowed).toBe(false);
  });

  it('denies actions on expired tokens', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    // Manually expire the token
    token.expiresAt = new Date(Date.now() - 1000);

    const result = enforceCapability(token, { type: 'path', target: '~/Projects/app' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('expired');
  });
});

describe('isTokenExpired', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for fresh tokens', () => {
    const token = createCapabilityToken('job-1', makePolicy());
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for expired tokens', () => {
    const token: WorkerCapabilityToken = {
      jobId: 'old-job',
      allowedPaths: [],
      deniedPaths: [],
      allowedCommands: [],
      allowedTools: [],
      maxExecutionTime: 60_000,
      createdAt: new Date('2020-01-01'),
      expiresAt: new Date('2020-01-01T00:30:00'),
    };
    expect(isTokenExpired(token)).toBe(true);
  });
});
