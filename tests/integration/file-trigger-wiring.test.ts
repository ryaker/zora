/**
 * Integration: file_change trigger wiring
 *
 * Proves that RoutineManager + EventTriggerManager actually watch files and fire
 * when they change. Uses real filesystem operations — no mocks for fs or timers.
 *
 * EventTriggerManager uses polling (fs.stat + setInterval), not fs.watch.
 * We use a 30ms poll interval throughout to keep tests fast.
 *
 * TEST-20 follow-up: every "sleep 80ms, then assert" in this file was racing the
 * disk. Detection is not instantaneous — it costs a poll tick plus a `stat`
 * round trip — and the watcher only reports a change once it holds a *previous*
 * mtime to compare against. Injecting 120ms of `fs.stat` latency reproduced the
 * reported failure of `debounce coalesces …` exactly: the baseline poll landed
 * after all five writes, so the final mtime silently became the baseline, no
 * change was ever detected, and `expect(callCount).toBeGreaterThan(0)` saw zero.
 * (90ms of injected latency still passed; the margin was under 100ms.)
 *
 * Every wait below is now either a condition polled against a deadline — so
 * load makes a test slower rather than wrong — or an observation window for an
 * invariant that no amount of waiting can change.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { RoutineManager } from '../../src/routines/routine-manager.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a unique temp directory for a test. */
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'zora-wiring-'));
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Wait for a condition to become true, polling every 5ms.
 * Rejects after `timeoutMs` with a descriptive message.
 *
 * Uses `performance.now()`, not `Date.now()`: `debounce coalesces …` freezes
 * `Date`, and a deadline measured against a frozen clock never expires.
 */
async function until(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = await predicate();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (performance.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Rewrite `filePath` until the watcher reports the change.
 *
 * A watcher fires only once it has a previous mtime to compare against, and it
 * records that baseline on its first poll. Writing once and trusting that the
 * baseline poll already happened is the flake this file had: if the write won
 * the race, its mtime *became* the baseline and no callback ever came. Writing
 * until the callback arrives removes the ordering assumption entirely.
 */
async function touchUntilDetected(
  filePath: string,
  detected: () => boolean,
  description: string,
): Promise<void> {
  let n = 0;
  await until(async () => {
    if (detected()) return true;
    await fs.writeFile(filePath, `change-${n++}`);
    return detected();
  }, description);
}

// ─── Test state ───────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];
const managers: RoutineManager[] = [];

afterEach(async () => {
  // Stop all watchers before removing dirs to avoid dangling intervals
  for (const m of managers) {
    m.stopAll();
  }
  managers.length = 0;

  vi.useRealTimers();

  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

// ─── Test 1: file_change trigger fires routine callback on file write ─────────

describe('file_change trigger wiring', () => {
  it('fires the routine callback when a watched file is written', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'trigger.txt');
    await fs.writeFile(watchFile, 'initial');

    const calls: string[] = [];
    const submitter = async (opts: { prompt: string }): Promise<string> => {
      calls.push(opts.prompt);
      return 'ok';
    };

    // Poll every 30ms so tests run quickly
    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    manager.watchRoutine({
      routine: {
        name: 'wiring-test',
        trigger: 'file_change',
        watch_path: watchFile,
      },
      task: { prompt: 'file-changed-callback' },
    });

    expect(manager.watchedCount).toBe(1);

    await touchUntilDetected(
      watchFile,
      () => calls.length >= 1,
      'the routine callback to fire after a file write',
    );

    expect(calls).toContain('file-changed-callback');
  }, 20_000);

  // ─── Test 2: Debounce coalesces rapid writes ────────────────────────────────

  it('debounce coalesces rapid file writes into fewer callbacks', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'debounce.txt');
    const tracerFile = path.join(tmpDir, 'tracer.txt');
    await fs.writeFile(watchFile, 'v0');
    await fs.writeFile(tracerFile, 'v0');

    let callCount = 0;
    let tracerCount = 0;
    const submitter = async (opts: { prompt: string }): Promise<string> => {
      if (opts.prompt === 'debounced') callCount++;
      else tracerCount++;
      return 'ok';
    };

    // TEST-20: freeze the clock the debounce window is measured against. Only
    // `Date` is faked — setInterval, setTimeout and the filesystem stay real, so
    // this still drives the real polling loop and the real `_parseDebounceMs`
    // path. What it removes is the load sensitivity: with `Date.now()` pinned, a
    // write that lands inside the window is suppressed no matter how long the
    // machine stalls, so "still exactly one call" can never be won or lost by
    // scheduling luck. Opening the window becomes an explicit clock step.
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(t0);

    const debounceMs = 100;
    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    manager.watchRoutine({
      routine: {
        name: 'debounce-test',
        trigger: 'file_change',
        watch_path: watchFile,
        debounce: '100ms',
      },
      task: { prompt: 'debounced' },
    });
    // The tracer watches a second file with no debounce, so it fires on every
    // change it sees. It exists to prove polling really happened during the
    // suppression window — otherwise "still exactly one call" could pass simply
    // because nothing was ever polled.
    manager.watchRoutine({
      routine: {
        name: 'tracer',
        trigger: 'file_change',
        watch_path: tracerFile,
      },
      task: { prompt: 'tracer' },
    });

    // The first detected change fires and opens the debounce window at t0.
    await touchUntilDetected(watchFile, () => callCount > 0, 'the first change to fire');
    expect(callCount).toBe(1);

    // A burst of writes inside the frozen window must all be swallowed.
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(watchFile, `v${i}`);
    }

    // Two tracer changes after the burst guarantee full poll cycles elapsed
    // while the burst was pending, so the suppression below is observed, not
    // assumed.
    await touchUntilDetected(tracerFile, () => tracerCount > 0, 'tracer change 1');
    await touchUntilDetected(tracerFile, () => tracerCount > 1, 'tracer change 2');

    expect(callCount).toBe(1);

    // Step past the debounce window: the next change is allowed through.
    vi.setSystemTime(t0 + debounceMs + 1);
    await touchUntilDetected(
      watchFile,
      () => callCount > 1,
      'a change after the debounce window to fire',
    );
    expect(callCount).toBe(2);
  }, 20_000);

  // ─── Test 3: stopAll() tears down watchers, no callbacks after stop ─────────

  it('stopAll() tears down watchers and no callbacks fire after stop', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'stop-test.txt');
    await fs.writeFile(watchFile, 'initial');

    let callCount = 0;
    const submitter = async (): Promise<string> => {
      callCount++;
      return 'ok';
    };

    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    manager.watchRoutine({
      routine: {
        name: 'stop-test',
        trigger: 'file_change',
        watch_path: watchFile,
      },
      task: { prompt: 'should-not-fire-after-stop' },
    });

    expect(manager.watchedCount).toBe(1);

    // Only stop once the watcher is demonstrably live. Stopping a watcher that
    // had not baselined yet would leave this test green even if stopAll() did
    // nothing at all.
    await touchUntilDetected(watchFile, () => callCount > 0, 'the watcher to fire before stopping');

    manager.stopAll();
    expect(manager.watchedCount).toBe(0);
    callCount = 0;

    // Write a file after stopping
    await fs.writeFile(watchFile, 'written-after-stop');

    // Nothing is watching any more, so no amount of waiting can produce a
    // callback — this observation window is safe to keep short.
    await new Promise((r) => setTimeout(r, 150));

    expect(callCount).toBe(0);
  }, 20_000);

  // ─── Test 4: cron routine still works alongside file_change routine ──────────

  it('cron routine coexists with file_change routine independently', async () => {
    const tmpDir = await makeTmpDir();
    tmpDirs.push(tmpDir);

    const watchFile = path.join(tmpDir, 'coexist.txt');
    await fs.writeFile(watchFile, 'init');

    const fileCallPrompts: string[] = [];
    const submitter = async (opts: { prompt: string }): Promise<string> => {
      fileCallPrompts.push(opts.prompt);
      return 'ok';
    };

    const manager = new RoutineManager(submitter, tmpDir, 30);
    managers.push(manager);

    // Register a cron routine (1-minute schedule, won't fire during test)
    manager.scheduleRoutine({
      routine: { name: 'cron-coexist', schedule: '* * * * *' },
      task: { prompt: 'cron-task' },
    });

    // Register a file_change routine
    manager.watchRoutine({
      routine: {
        name: 'file-coexist',
        trigger: 'file_change',
        watch_path: watchFile,
      },
      task: { prompt: 'file-task' },
    });

    // Both should be registered without interfering
    expect(manager.scheduledCount).toBe(1);
    expect(manager.watchedCount).toBe(1);

    await touchUntilDetected(
      watchFile,
      () => fileCallPrompts.includes('file-task'),
      'the file-task callback to fire',
    );

    // File task fired; cron task did NOT fire (schedule is 1 min away)
    expect(fileCallPrompts).toContain('file-task');
    expect(fileCallPrompts).not.toContain('cron-task');

    // Counts remain consistent until explicit stop
    expect(manager.scheduledCount).toBe(1);
    expect(manager.watchedCount).toBe(1);

    manager.stopAll();

    expect(manager.scheduledCount).toBe(0);
    expect(manager.watchedCount).toBe(0);
  }, 20_000);
});
