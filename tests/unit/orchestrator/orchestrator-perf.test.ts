/**
 * Efficiency fixes in the Orchestrator (PERF-01, PERF-03, PERF-04, PERF-05, PERF-06).
 *
 * These exercise the caching / scheduling behaviour directly rather than through
 * a full boot, so they stay fast and do not depend on provider mocks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { Orchestrator } from '../../../src/orchestrator/orchestrator.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { ZoraConfig, ZoraPolicy } from '../../../src/types.js';

function makePolicy(): ZoraPolicy {
  return {
    filesystem: { allowed_paths: ['/tmp'], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
    shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
    actions: { reversible: ['read_file'], irreversible: ['write_file'], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
  };
}

function makeConfig(baseDir: string, soulFile: string): ZoraConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.agent.log_level = 'error';
  config.agent.workspace = path.join(baseDir, 'workspace');
  config.agent.identity.soul_file = soulFile;
  return config;
}

/** Builds an unbooted Orchestrator — enough to exercise the SOUL.md cache. */
function makeOrchestrator(baseDir: string, soulFile: string): Orchestrator {
  return new Orchestrator({
    config: makeConfig(baseDir, soulFile),
    policy: makePolicy(),
    providers: [new MockProvider({ name: 'primary', rank: 1 })],
    baseDir,
    skipChannels: true,
  });
}

/** Private-member access for the cache internals under test. */
interface SoulInternals {
  _loadSoulIdentity(): string;
  _soulWatcher: fs.FSWatcher | null;
  _soulLoaded: boolean;
}

function soul(orchestrator: Orchestrator): SoulInternals {
  return orchestrator as unknown as SoulInternals;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return predicate();
}

describe('PERF-03 — SOUL.md identity cache', () => {
  let testDir: string;
  let soulPath: string;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `zora-perf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fsp.mkdir(testDir, { recursive: true });
    soulPath = path.join(testDir, 'SOUL.md');
  });

  afterEach(async () => {
    if (orchestrator?.isBooted) await orchestrator.shutdown();
    // Close any watcher left open by a non-booted orchestrator.
    const watcher = orchestrator ? soul(orchestrator)._soulWatcher : null;
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } }
    vi.restoreAllMocks();
    await fsp.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('reads SOUL.md once and serves later calls from memory', async () => {
    await fsp.writeFile(soulPath, '  You are Zora, the test identity.  \n');
    orchestrator = makeOrchestrator(testDir, soulPath);

    const readSpy = vi.spyOn(fs, 'readFileSync');

    const first = soul(orchestrator)._loadSoulIdentity();
    expect(first).toBe('You are Zora, the test identity.');
    const readsAfterFirst = readSpy.mock.calls.filter(c => String(c[0]) === soulPath).length;
    expect(readsAfterFirst).toBe(1);

    for (let i = 0; i < 50; i++) {
      expect(soul(orchestrator)._loadSoulIdentity()).toBe('You are Zora, the test identity.');
    }
    const readsAfterMany = readSpy.mock.calls.filter(c => String(c[0]) === soulPath).length;
    expect(readsAfterMany).toBe(1);
  });

  it('falls back to the empty string when SOUL.md is missing', () => {
    orchestrator = makeOrchestrator(testDir, soulPath);
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('');
    // And it caches the miss rather than re-stat'ing every task.
    const existsSpy = vi.spyOn(fs, 'existsSync');
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('');
    expect(existsSpy.mock.calls.filter(c => String(c[0]) === soulPath)).toHaveLength(0);
  });

  it('falls back to the empty string when SOUL.md is unreadable', async () => {
    await fsp.writeFile(soulPath, 'unreadable');
    orchestrator = makeOrchestrator(testDir, soulPath);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('EACCES'); });
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('');
  });

  it('does not throw when the watch cannot be established', () => {
    // Directory does not exist -> fs.watch throws -> must degrade, not propagate.
    const missing = path.join(testDir, 'no-such-dir', 'SOUL.md');
    orchestrator = makeOrchestrator(testDir, missing);
    expect(() => soul(orchestrator)._loadSoulIdentity()).not.toThrow();
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('');
  });

  it('keeps serving the cached value when the watcher errors out', async () => {
    await fsp.writeFile(soulPath, 'original identity');
    orchestrator = makeOrchestrator(testDir, soulPath);
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('original identity');

    const watcher = soul(orchestrator)._soulWatcher;
    if (watcher) {
      // A watcher 'error' must be handled, not thrown as unhandled.
      expect(() => watcher.emit('error', new Error('inotify exhausted'))).not.toThrow();
    }
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('original identity');
  });

  it('picks up an edited SOUL.md via the watch', async () => {
    await fsp.writeFile(soulPath, 'original identity');
    orchestrator = makeOrchestrator(testDir, soulPath);
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('original identity');

    if (!soul(orchestrator)._soulWatcher) {
      // Filesystem refuses watches (some CI containers). Cached value must stand.
      expect(soul(orchestrator)._loadSoulIdentity()).toBe('original identity');
      return;
    }

    await fsp.writeFile(soulPath, 'revised identity');
    const invalidated = await waitFor(() => soul(orchestrator)._soulLoaded === false);

    if (!invalidated) {
      // Watch event never landed — degrade to the cached value rather than fail.
      expect(soul(orchestrator)._loadSoulIdentity()).toBe('original identity');
      return;
    }
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('revised identity');
  });

  it('re-reads when the configured soul_file path changes', async () => {
    await fsp.writeFile(soulPath, 'first identity');
    orchestrator = makeOrchestrator(testDir, soulPath);
    expect(soul(orchestrator)._loadSoulIdentity()).toBe('first identity');

    const otherPath = path.join(testDir, 'OTHER_SOUL.md');
    await fsp.writeFile(otherPath, 'second identity');
    (orchestrator as unknown as { _config: ZoraConfig })._config.agent.identity.soul_file = otherPath;

    expect(soul(orchestrator)._loadSoulIdentity()).toBe('second identity');
  });
});

// ─── PERF-04 ─────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

/** The five self-rescheduling background loops. */
const BACKGROUND_TIMER_FIELDS = [
  '_authCheckTimeout',
  '_retryPollTimeout',
  '_consolidationTimeout',
  '_integrityCheckTimeout',
  '_memoryExtractIntervalTimeout',
] as const;

interface TimerInternals {
  _authCheckTimeout: NodeJS.Timeout | null;
  _retryPollTimeout: NodeJS.Timeout | null;
  _consolidationTimeout: NodeJS.Timeout | null;
  _integrityCheckTimeout: NodeJS.Timeout | null;
  _memoryExtractIntervalTimeout: NodeJS.Timeout | null;
}

describe('PERF-04 — background timers are unref\'d', () => {
  let testDir: string;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `zora-perf04-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fsp.mkdir(testDir, { recursive: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (orchestrator?.isBooted) await orchestrator.shutdown();
    vi.restoreAllMocks();
    await fsp.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('every background timer is scheduled without a ref on the event loop', async () => {
    const config = makeConfig(testDir, path.join(testDir, 'SOUL.md'));
    config.memory.long_term_file = path.join(testDir, 'memory', 'MEMORY.md');
    config.memory.daily_notes_dir = path.join(testDir, 'memory', 'daily');
    config.memory.items_dir = path.join(testDir, 'memory', 'items');
    config.memory.categories_dir = path.join(testDir, 'memory', 'categories');
    config.memory.auto_extract = true;
    config.memory.auto_extract_interval = 10;
    config.security.policy_file = path.join(testDir, 'policy.toml');
    config.security.audit_log = path.join(testDir, 'audit', 'audit.jsonl');
    config.steering.enabled = false;
    config.notifications.enabled = false;

    orchestrator = new Orchestrator({
      config,
      policy: makePolicy(),
      providers: [new MockProvider({ name: 'primary', rank: 1 })],
      baseDir: testDir,
      skipChannels: true,
    });
    await orchestrator.boot();

    const timers = orchestrator as unknown as TimerInternals;
    for (const field of BACKGROUND_TIMER_FIELDS) {
      const timer = timers[field];
      expect(timer, `${field} should be scheduled after boot`).toBeTruthy();
      // hasRef() === false is what lets the process exit with the timer pending.
      expect(timer!.hasRef(), `${field} must be unref'd`).toBe(false);
    }
  }, 30_000);

  it('a booted orchestrator lets the process exit without shutdown()', () => {
    const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
    if (!fs.existsSync(tsx)) return; // tsx unavailable — nothing to probe with.

    const probe = path.join(REPO_ROOT, 'tests', 'fixtures', 'perf04-exit-probe.ts');
    const result = spawnSync(tsx, [probe, '--no-shutdown'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });

    // A timeout kill (SIGTERM, null status) is exactly the regression: a ref'd
    // timer kept the event loop alive after the task finished.
    expect(result.signal, 'exit probe hung — a background timer is still ref\'d').toBeNull();
    expect(result.stdout).toContain('EXIT_PROBE_OK');
    expect(result.status).toBe(0);
  }, 90_000);
});
