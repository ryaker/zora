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
import type { TaskContext, ZoraConfig, ZoraPolicy } from '../../../src/types.js';

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

    // PERF-05 means the retry poll only arms when something is queued.
    await orchestrator.retryQueue.enqueue({
      jobId: 'perf04-job',
      task: 'retry me',
      requiredCapabilities: [],
      complexity: 'simple',
      resourceType: 'general',
      systemPrompt: '',
      memoryContext: [],
      history: [],
    }, 'boom', 3);
    (orchestrator as unknown as { _armRetryPoll(): void })._armRetryPoll();

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

// ─── PERF-05 ─────────────────────────────────────────────────────

interface RetryInternals {
  _armRetryPoll(): void;
  _pollRetryQueue(): Promise<void>;
  _scheduleBackground(fn: () => void, ms: number): NodeJS.Timeout;
  _resumeTask(task: TaskContext): Promise<string>;
  _retryPollTimeout: NodeJS.Timeout | null;
}

function retry(orchestrator: Orchestrator): RetryInternals {
  return orchestrator as unknown as RetryInternals;
}

/** Reaches into the queue's backing array to age an entry, as a restart would. */
function setNextRunAt(orchestrator: Orchestrator, index: number, at: Date): void {
  (orchestrator.retryQueue as unknown as { _queue: Array<{ nextRunAt: Date }> })._queue[index]!.nextRunAt = at;
}

function makeTask(jobId: string): TaskContext {
  return {
    jobId,
    task: 'retry me',
    requiredCapabilities: [],
    complexity: 'simple',
    resourceType: 'general',
    systemPrompt: '',
    memoryContext: [],
    history: [],
  };
}

describe('PERF-05 — demand-driven retry scheduling', () => {
  let testDir: string;
  let orchestrator: Orchestrator;

  async function boot(retryAfterCooldown = true): Promise<Orchestrator> {
    const config = makeConfig(testDir, path.join(testDir, 'SOUL.md'));
    config.memory.long_term_file = path.join(testDir, 'memory', 'MEMORY.md');
    config.memory.daily_notes_dir = path.join(testDir, 'memory', 'daily');
    config.memory.items_dir = path.join(testDir, 'memory', 'items');
    config.memory.categories_dir = path.join(testDir, 'memory', 'categories');
    config.memory.auto_extract = false;
    config.security.policy_file = path.join(testDir, 'policy.toml');
    config.security.audit_log = path.join(testDir, 'audit', 'audit.jsonl');
    config.failover.retry_after_cooldown = retryAfterCooldown;
    config.steering.enabled = false;
    config.notifications.enabled = false;

    const o = new Orchestrator({
      config,
      policy: makePolicy(),
      providers: [new MockProvider({ name: 'primary', rank: 1 })],
      baseDir: testDir,
      skipChannels: true,
    });
    await o.boot();
    return o;
  }

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `zora-perf05-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fsp.mkdir(testDir, { recursive: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (orchestrator?.isBooted) await orchestrator.shutdown();
    vi.restoreAllMocks();
    await fsp.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('schedules nothing while the queue is empty', async () => {
    orchestrator = await boot();
    expect(orchestrator.retryQueue.size).toBe(0);
    expect(retry(orchestrator)._retryPollTimeout).toBeNull();
  }, 30_000);

  it('wakes at the earliest entry ready time, not on a fixed tick', async () => {
    orchestrator = await boot();
    // First enqueue backs off 1 minute (retryCount^2 minutes).
    await orchestrator.retryQueue.enqueue(makeTask('job-a'), 'boom', 3);

    const spy = vi.spyOn(retry(orchestrator), '_scheduleBackground');
    retry(orchestrator)._armRetryPoll();

    expect(spy).toHaveBeenCalledTimes(1);
    const delay = spy.mock.calls[0]![1];
    // ~60s, and emphatically not the old 30s tick.
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  }, 30_000);

  it('re-arms automatically when an entry is enqueued', async () => {
    orchestrator = await boot();
    expect(retry(orchestrator)._retryPollTimeout).toBeNull();

    // The private enqueue path is what the failover code calls.
    await (orchestrator as unknown as { _enqueueRetry(t: TaskContext, e: string): Promise<void> })
      ._enqueueRetry(makeTask('job-b'), 'boom');

    expect(orchestrator.retryQueue.size).toBe(1);
    expect(retry(orchestrator)._retryPollTimeout).not.toBeNull();
  }, 30_000);

  it('floors an overdue entry at the old 30s cadence rather than spinning', async () => {
    orchestrator = await boot();
    await orchestrator.retryQueue.enqueue(makeTask('job-c'), 'boom', 3);
    // Force the entry into the past, as a failed retry or a restart would.
    setNextRunAt(orchestrator, 0, new Date(Date.now() - 60_000));

    const spy = vi.spyOn(retry(orchestrator), '_scheduleBackground');
    retry(orchestrator)._armRetryPoll();
    expect(spy.mock.calls[0]![1]).toBe(30_000);
  }, 30_000);

  it('caps the sleep so a long backoff still gets re-checked', async () => {
    orchestrator = await boot();
    await orchestrator.retryQueue.enqueue(makeTask('job-d'), 'boom', 3);
    // Backoff caps at 24h; the poll must not sleep that long.
    setNextRunAt(orchestrator, 0, new Date(Date.now() + 24 * 60 * 60 * 1000));

    const spy = vi.spyOn(retry(orchestrator), '_scheduleBackground');
    retry(orchestrator)._armRetryPoll();
    expect(spy.mock.calls[0]![1]).toBe(15 * 60 * 1000);
  }, 30_000);

  it('honours the retry_after_cooldown guard', async () => {
    orchestrator = await boot(/* retryAfterCooldown */ false);
    await orchestrator.retryQueue.enqueue(makeTask('job-e'), 'boom', 3);
    setNextRunAt(orchestrator, 0, new Date(Date.now() - 1000));

    const resume = vi.spyOn(retry(orchestrator), '_resumeTask').mockResolvedValue('never');
    await retry(orchestrator)._pollRetryQueue();

    expect(resume).not.toHaveBeenCalled();
    expect(orchestrator.retryQueue.size).toBe(1); // entry untouched
    expect(retry(orchestrator)._retryPollTimeout).not.toBeNull(); // still re-armed
  }, 30_000);

  it('drains a due entry and stops scheduling once the queue empties', async () => {
    orchestrator = await boot();
    await orchestrator.retryQueue.enqueue(makeTask('job-f'), 'boom', 3);
    setNextRunAt(orchestrator, 0, new Date(Date.now() - 1000));

    const resume = vi.spyOn(retry(orchestrator), '_resumeTask').mockResolvedValue('ok');
    await retry(orchestrator)._pollRetryQueue();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(orchestrator.retryQueue.size).toBe(0);
    // Nothing left to wait for — no wakeups at all.
    expect(retry(orchestrator)._retryPollTimeout).toBeNull();
  }, 30_000);

  it('drops an entry whose error budget is exhausted, without resuming it', async () => {
    orchestrator = await boot();
    const task = makeTask('job-g');
    task.errorBudget = { maxBudget: 2, budgetConsumed: 1, maxTurns: 0, turnsConsumed: 0 };
    await orchestrator.retryQueue.enqueue(task, 'boom', 3);
    setNextRunAt(orchestrator, 0, new Date(Date.now() - 1000));

    const resume = vi.spyOn(retry(orchestrator), '_resumeTask').mockResolvedValue('ok');
    await retry(orchestrator)._pollRetryQueue();

    expect(resume).not.toHaveBeenCalled();
    expect(orchestrator.retryQueue.size).toBe(0);
  }, 30_000);
});

// ─── PERF-06 ─────────────────────────────────────────────────────

interface ToolInternals {
  _buildCustomTools(): Array<{ name: string }>;
  _getCustomTools(): Array<{ name: string }>;
  _customTools: Array<{ name: string }> | null;
  _buildTokenAwareCanUseTool(jobId: string): unknown;
}

function tools(orchestrator: Orchestrator): ToolInternals {
  return orchestrator as unknown as ToolInternals;
}

describe('PERF-06 — custom tools built once at boot', () => {
  let testDir: string;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `zora-perf06-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fsp.mkdir(testDir, { recursive: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = makeConfig(testDir, path.join(testDir, 'SOUL.md'));
    config.memory.long_term_file = path.join(testDir, 'memory', 'MEMORY.md');
    config.memory.daily_notes_dir = path.join(testDir, 'memory', 'daily');
    config.memory.items_dir = path.join(testDir, 'memory', 'items');
    config.memory.categories_dir = path.join(testDir, 'memory', 'categories');
    config.memory.auto_extract = false;
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
  });

  afterEach(async () => {
    if (orchestrator?.isBooted) await orchestrator.shutdown();
    vi.restoreAllMocks();
    await fsp.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('builds the definitions during boot, not on demand', () => {
    expect(tools(orchestrator)._customTools).not.toBeNull();
    expect(tools(orchestrator)._customTools!.length).toBeGreaterThan(5);
  }, 30_000);

  it('does not rebuild the definitions per task', async () => {
    const build = vi.spyOn(tools(orchestrator), '_buildCustomTools');
    const first = tools(orchestrator)._getCustomTools();

    await orchestrator.submitTask({ prompt: 'one' });
    await orchestrator.submitTask({ prompt: 'two' });

    expect(build).not.toHaveBeenCalled();
    // Same array instance, so the SDK sees stable tool identities across jobs.
    expect(tools(orchestrator)._getCustomTools()).toBe(first);
  }, 60_000);

  it('keeps canUseTool per task even though the tool list is shared', () => {
    const a = tools(orchestrator)._buildTokenAwareCanUseTool('job-a');
    const b = tools(orchestrator)._buildTokenAwareCanUseTool('job-b');
    expect(a).not.toBe(b);
  }, 30_000);

  it('exposes the same tool names as a fresh build', () => {
    const cached = tools(orchestrator)._getCustomTools().map(t => t.name).sort();
    const rebuilt = tools(orchestrator)._buildCustomTools().map(t => t.name).sort();
    expect(cached).toEqual(rebuilt);
  }, 30_000);

  it('drops the cache on shutdown so a re-boot rebinds to new subsystems', async () => {
    const before = tools(orchestrator)._getCustomTools();
    await orchestrator.shutdown();
    expect(tools(orchestrator)._customTools).toBeNull();

    await orchestrator.boot();
    expect(tools(orchestrator)._getCustomTools()).not.toBe(before);
  }, 60_000);
});
