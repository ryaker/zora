/**
 * Integration tests: security config fields reach runtime components.
 *
 * PR #160 wired 10 security.* config fields into the Orchestrator runtime.
 * These tests verify that the config values produce observable behaviour —
 * i.e. that the wiring is real, not dead code.
 *
 * Test scope:
 *   1. AuditLogger hashChain respects config (component-level, real AuditLogger)
 *   2. NotificationTools master toggle (component-level, via real NotificationTools)
 *   3. Always-on security fields emit console.warn when disabled (Orchestrator boot)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { AuditLogger } from '../../src/security/audit-logger.js';
import { NotificationTools } from '../../src/tools/notifications.js';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import type { ZoraConfig, ZoraPolicy } from '../../src/types.js';

// ─── Shared helpers ────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'zora-sec-wiring-'));
}

function makePolicy(): ZoraPolicy {
  return {
    filesystem: {
      allowed_paths: ['/tmp'],
      denied_paths: ['/etc/passwd'],
      resolve_symlinks: false,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['echo'],
      denied_commands: ['rm'],
      split_chained_commands: true,
      max_execution_time: '30s',
    },
    actions: {
      reversible: ['read_file'],
      irreversible: ['delete_file'],
      always_flag: ['delete_file'],
    },
    network: {
      allowed_domains: ['*.example.com'],
      denied_domains: ['evil.com'],
      max_request_size: '10MB',
    },
  };
}

function makeConfig(baseDir: string, overrides: Partial<ZoraConfig['security']> = {}): ZoraConfig {
  return {
    agent: {
      name: 'zora-sec-wiring-test',
      workspace: path.join(baseDir, 'workspace'),
      max_parallel_jobs: 1,
      default_timeout: '1h',
      heartbeat_interval: '60m',
      log_level: 'error',
      identity: { soul_file: path.join(baseDir, 'SOUL.md') },
      resources: { cpu_throttle_percent: 80, memory_limit_mb: 1024, throttle_check_interval: '10s' },
    },
    providers: [],
    routing: { mode: 'respect_ranking' },
    failover: {
      enabled: false,
      auto_handoff: false,
      max_handoff_context_tokens: 50000,
      retry_after_cooldown: false,
      max_retries: 1,
      checkpoint_on_auth_failure: false,
      notify_on_failover: false,
    },
    memory: {
      long_term_file: path.join(baseDir, 'memory', 'MEMORY.md'),
      daily_notes_dir: path.join(baseDir, 'memory', 'daily'),
      items_dir: path.join(baseDir, 'memory', 'items'),
      categories_dir: path.join(baseDir, 'memory', 'categories'),
      context_days: 7,
      max_context_items: 20,
      max_category_summaries: 5,
      auto_extract_interval: 10,
      auto_extract: false,
    },
    security: {
      policy_file: path.join(baseDir, 'policy.toml'),
      audit_log: path.join(baseDir, 'audit', 'audit.jsonl'),
      audit_hash_chain: false,
      audit_single_writer: false,
      integrity_check: false,
      integrity_interval: '60m',
      integrity_includes_tool_registry: false,
      leak_detection: false,
      sanitize_untrusted_content: false,
      jit_secret_decryption: false,
      ...overrides,
    },
    steering: {
      enabled: false,
      poll_interval: '5s',
      dashboard_port: 0,
      notify_on_flag: false,
      flag_timeout: '10m',
      auto_approve_low_risk: true,
      always_flag_irreversible: true,
    },
    notifications: {
      enabled: false,
      on_task_complete: false,
      on_error: false,
      on_failover: false,
      on_auth_expiry: false,
      on_all_providers_down: false,
    },
  };
}

/** Minimal AuditEntry input for log() calls. */
function makeAuditInput() {
  return {
    jobId: 'test-job-1',
    eventType: 'tool_invocation' as const,
    timestamp: new Date().toISOString(),
    provider: 'test-provider',
    toolName: 'test_tool',
    parameters: {},
    result: { status: 'ok' as const, output: 'done' },
  };
}

// ─── Test 1: AuditLogger hashChain ─────────────────────────────────────────

describe('Security config wiring — AuditLogger hashChain', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    logPath = path.join(tmpDir, 'audit', 'audit.jsonl');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes entries WITH chain fields when hashChain=true', async () => {
    const logger = new AuditLogger(logPath, { hashChain: true, singleWriter: true });

    await logger.log(makeAuditInput());
    await logger.log(makeAuditInput());

    const entries = await logger.readEntries();
    expect(entries).toHaveLength(2);

    // First entry: previousHash is the genesis sentinel, hash is a SHA-256 hex
    const first = entries[0]!;
    expect(first.previousHash).toBe('genesis');
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);

    // Second entry: previousHash must equal first entry's hash (the chain link)
    const second = entries[1]!;
    expect(second.previousHash).toBe(first.hash);
    expect(second.hash).toMatch(/^[0-9a-f]{64}$/);

    // Chain verification must pass
    const verification = await logger.verifyChain();
    expect(verification.valid).toBe(true);
    expect(verification.entries).toBe(2);
  });

  it('writes entries WITHOUT meaningful hash fields when hashChain=false', async () => {
    const logger = new AuditLogger(logPath, { hashChain: false, singleWriter: false });

    await logger.log(makeAuditInput());
    await logger.log(makeAuditInput());

    const entries = await logger.readEntries();
    expect(entries).toHaveLength(2);

    // When hashChain is disabled, both previousHash and hash are empty strings
    for (const entry of entries) {
      expect(entry.previousHash).toBe('');
      expect(entry.hash).toBe('');
    }
  });

  it('hash chain is tamper-evident: mutating an entry breaks verification', async () => {
    const logger = new AuditLogger(logPath, { hashChain: true, singleWriter: true });

    await logger.log(makeAuditInput());
    await logger.log(makeAuditInput());

    // Tamper with the first line in the log file
    const raw = await fs.readFile(logPath, 'utf-8');
    const lines = raw.trim().split('\n');
    const firstEntry = JSON.parse(lines[0]!) as Record<string, unknown>;
    firstEntry['toolName'] = 'tampered_tool';
    lines[0] = JSON.stringify(firstEntry);
    await fs.writeFile(logPath, lines.join('\n') + '\n', 'utf-8');

    // A fresh logger reading the same file must detect the tampering
    const reader = new AuditLogger(logPath, { hashChain: true });
    const result = await reader.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });
});

// ─── Test 2: NotificationTools master toggle ───────────────────────────────

describe('Security config wiring — NotificationTools master toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips notification dispatch when notifications.enabled=false', async () => {
    const tools = new NotificationTools({ enabled: false, on_task_complete: true, on_error: true, on_failover: true, on_auth_expiry: true, on_all_providers_down: true });

    // Spy on the internal notify() method to confirm it returns without calling osascript
    const notifySpy = vi.spyOn(tools, 'notify');

    await tools.notifyTaskComplete('job-001', 'All done');

    // notify() should have been called but must return without dispatching
    // (enabled=false causes early return at the top of notify())
    // The spy confirms the guarded path — notifyTaskComplete() bails before notify()
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('skips all typed notification helpers when enabled=false', async () => {
    const tools = new NotificationTools({ enabled: false, on_task_complete: true, on_error: true, on_failover: true, on_auth_expiry: true, on_all_providers_down: true });

    const notifySpy = vi.spyOn(tools, 'notify');

    // All helpers must be no-ops when master toggle is off
    await tools.notifyTaskComplete('j1', 'done');
    await tools.notifyError('j2', 'something went wrong');
    await tools.notifyFailover('primary', 'secondary', 'quota');
    await tools.notifyAuthExpiry('gemini', 2);
    await tools.notifyAllProvidersDown();

    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('invokes notify() when enabled=true and per-event toggle is on', async () => {
    const tools = new NotificationTools({ enabled: true, on_task_complete: true, on_error: true, on_failover: true, on_auth_expiry: true, on_all_providers_down: true });

    // Stub notify() itself so we do not attempt osascript in CI
    const notifySpy = vi.spyOn(tools, 'notify').mockResolvedValue(undefined);

    await tools.notifyTaskComplete('j1', 'summary text');

    expect(notifySpy).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledWith('Task Complete', 'summary text');
  });

  it('skips notify() when per-event toggle on_task_complete=false even if enabled=true', async () => {
    const tools = new NotificationTools({ enabled: true, on_task_complete: false, on_error: true, on_failover: true, on_auth_expiry: true, on_all_providers_down: true });

    const notifySpy = vi.spyOn(tools, 'notify').mockResolvedValue(undefined);

    await tools.notifyTaskComplete('j1', 'should be suppressed');

    expect(notifySpy).not.toHaveBeenCalled();
  });
});

// ─── Test 3: Always-on security fields warn when disabled ──────────────────

describe('Security config wiring — always-on fields emit console.warn', () => {
  let tmpDir: string;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (orchestrator?.isBooted) {
      await orchestrator.shutdown();
    }
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('emits console.warn mentioning leak_detection when leak_detection=false', async () => {
    const provider = new MockProvider({ name: 'mock', rank: 1 });
    orchestrator = new Orchestrator({
      config: makeConfig(tmpDir, { leak_detection: false }),
      policy: makePolicy(),
      providers: [provider],
      baseDir: tmpDir,
    });

    await orchestrator.boot();

    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const leakWarn = warnCalls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('leak_detection'),
    );
    expect(leakWarn).toBeDefined();
    expect(leakWarn![0]).toContain('always enabled');
  });

  it('emits console.warn for each disabled always-on field', async () => {
    const provider = new MockProvider({ name: 'mock', rank: 1 });
    orchestrator = new Orchestrator({
      config: makeConfig(tmpDir, {
        integrity_check: false,
        leak_detection: false,
        sanitize_untrusted_content: false,
        jit_secret_decryption: false,
      }),
      policy: makePolicy(),
      providers: [provider],
      baseDir: tmpDir,
    });

    await orchestrator.boot();

    const warnMessages = (console.warn as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter(Boolean);

    // Each disabled always-on field must produce a distinct warning
    expect(warnMessages.some((m) => m.includes('integrity_check'))).toBe(true);
    expect(warnMessages.some((m) => m.includes('leak_detection'))).toBe(true);
    expect(warnMessages.some((m) => m.includes('sanitize_untrusted_content'))).toBe(true);
    expect(warnMessages.some((m) => m.includes('jit_secret_decryption'))).toBe(true);
  });

  it('does NOT emit always-on warnings when all security fields are enabled', async () => {
    const provider = new MockProvider({ name: 'mock', rank: 1 });
    orchestrator = new Orchestrator({
      config: makeConfig(tmpDir, {
        // audit_log must be a non-empty string (truthy) to avoid the warning
        audit_log: path.join(tmpDir, 'audit', 'audit.jsonl'),
        integrity_check: true,
        leak_detection: true,
        sanitize_untrusted_content: true,
        jit_secret_decryption: true,
      }),
      policy: makePolicy(),
      providers: [provider],
      baseDir: tmpDir,
    });

    await orchestrator.boot();

    const alwaysOnWarns = (console.warn as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((m) => m.includes('is ignored') && m.includes('always enabled'));

    expect(alwaysOnWarns).toHaveLength(0);
  });
});
