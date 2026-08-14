import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventTriggerManager } from '../../../src/routines/event-triggers.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * TEST-20: these tests used to sleep a fixed 80 ms and then assert. Detection
 * is not instantaneous — it costs one poll tick plus a `readdir`/`stat` round
 * trip — so under filesystem contention the sleep expired before the watcher
 * had looked at the file and the assertion saw zero callbacks. Injecting 120 ms
 * of `fs.stat` latency reproduced exactly that failure.
 *
 * Every wait below is now either a condition polled against a deadline (a slow
 * machine only makes it take longer, never fail) or an observation window for
 * an invariant that cannot change with time (see `debounces rapid changes`).
 */
const DEFAULT_TIMEOUT_MS = 10_000;

async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  // performance.now(), not Date.now(): `debounces rapid changes` freezes Date,
  // and a deadline measured against a frozen clock never expires.
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
      throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Writes to `filePath` until the watcher reports a change.
 *
 * A watcher only fires once it has a previous mtime to compare against, and it
 * records that baseline on its first poll. Writing once and hoping the baseline
 * poll already happened is the other half of the old flake: if the write landed
 * first, the new mtime silently *became* the baseline and no callback ever came.
 * Rewriting until the callback arrives removes that ordering assumption.
 */
async function touchUntilDetected(
  filePath: string,
  detected: () => boolean,
  label: string,
): Promise<void> {
  let n = 0;
  await until(async () => {
    if (detected()) return true;
    await fs.writeFile(filePath, `change-${n++}`);
    return detected();
  }, label);
}

describe('EventTriggerManager', () => {
  const testDir = path.join(os.tmpdir(), `zora-triggers-test-${process.pid}-${Date.now()}`);

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('detects file changes via polling', async () => {
    const filePath = path.join(testDir, 'watched.txt');
    await fs.writeFile(filePath, 'initial');
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 20 });
    manager.watch(filePath, 0, callback);

    await touchUntilDetected(
      filePath,
      () => callback.mock.calls.length > 0,
      'the watcher to report a change',
    );

    expect(callback).toHaveBeenCalledWith(filePath);
    manager.unwatchAll();
  }, 20_000);

  it('debounces rapid changes', async () => {
    const filePath = path.join(testDir, 'rapid.txt');
    const tracerPath = path.join(testDir, 'tracer.txt');
    await fs.writeFile(filePath, 'v1');
    await fs.writeFile(tracerPath, 'v1');

    // TEST-20: freeze the clock the debounce window is measured against.
    // Only `Date` is faked — setInterval, setTimeout and the filesystem stay
    // real, so this still exercises the real polling loop. What it removes is
    // the load sensitivity: with `Date.now()` pinned, a change that lands
    // inside the window is suppressed no matter how long the machine stalls,
    // so the "still exactly one call" assertion can never be won or lost by
    // scheduling luck. Opening the window is then an explicit clock step.
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(t0);

    const debounceMs = 300;
    const callback = vi.fn();
    const tracer = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 20 });
    manager.watch(filePath, debounceMs, callback);
    manager.watch(tracerPath, 0, tracer);

    // First change fires and starts the debounce window (lastFired = t0).
    await touchUntilDetected(
      filePath,
      () => callback.mock.calls.length > 0,
      'the first change to fire',
    );
    expect(callback).toHaveBeenCalledTimes(1);

    // A second change inside the window must be swallowed.
    await fs.writeFile(filePath, 'inside-window');

    // The tracer proves polling really happened after that write, instead of
    // the assertion below passing because nothing was ever polled. Its debounce
    // is 0, so it fires on every detected change; waiting for two of its
    // changes guarantees a full poll cycle elapsed after `inside-window`.
    await touchUntilDetected(tracerPath, () => tracer.mock.calls.length > 0, 'tracer change 1');
    await touchUntilDetected(tracerPath, () => tracer.mock.calls.length > 1, 'tracer change 2');

    expect(callback).toHaveBeenCalledTimes(1);

    // Step past the debounce window: the next change is allowed through.
    vi.setSystemTime(t0 + debounceMs + 1);
    await touchUntilDetected(
      filePath,
      () => callback.mock.calls.length > 1,
      'a change after the debounce window to fire',
    );
    expect(callback).toHaveBeenCalledTimes(2);

    manager.unwatchAll();
  }, 20_000);

  it('supports glob patterns', async () => {
    const target = path.join(testDir, 'file1.txt');
    await fs.writeFile(target, 'a');
    await fs.writeFile(path.join(testDir, 'file2.txt'), 'b');
    await fs.writeFile(path.join(testDir, 'file3.log'), 'c');
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 20 });
    manager.watch(path.join(testDir, '*.txt'), 0, callback);

    await touchUntilDetected(
      target,
      () => callback.mock.calls.some((c) => c[0] === target),
      'the glob watcher to report the changed .txt file',
    );

    expect(callback).toHaveBeenCalledWith(target);
    expect(callback).not.toHaveBeenCalledWith(path.join(testDir, 'file3.log'));
    manager.unwatchAll();
  }, 20_000);

  it('unwatches a specific path', async () => {
    const filePath = path.join(testDir, 'unwatch-me.txt');
    const tracerPath = path.join(testDir, 'tracer.txt');
    await fs.writeFile(filePath, 'initial');
    await fs.writeFile(tracerPath, 'initial');
    const callback = vi.fn();
    const tracer = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 20 });
    manager.watch(filePath, 0, callback);
    manager.watch(tracerPath, 0, tracer);

    // Only unwatch once the watcher is demonstrably live, otherwise the test
    // would pass even if `unwatch` did nothing.
    await touchUntilDetected(filePath, () => callback.mock.calls.length > 0, 'the watcher to fire');
    manager.unwatch(filePath);
    callback.mockClear();

    await fs.writeFile(filePath, 'changed');
    // The tracer, still watching, proves polls continued to run afterwards.
    await touchUntilDetected(tracerPath, () => tracer.mock.calls.length > 1, 'tracer to keep firing');

    expect(callback).not.toHaveBeenCalled();
    manager.unwatchAll();
  }, 20_000);

  it('unwatchAll stops all watchers', async () => {
    const file1 = path.join(testDir, 'a.txt');
    const file2 = path.join(testDir, 'b.txt');
    await fs.writeFile(file1, 'x');
    await fs.writeFile(file2, 'y');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 20 });
    manager.watch(file1, 0, cb1);
    manager.watch(file2, 0, cb2);

    await touchUntilDetected(file1, () => cb1.mock.calls.length > 0, 'watcher 1 to fire');
    await touchUntilDetected(file2, () => cb2.mock.calls.length > 0, 'watcher 2 to fire');

    manager.unwatchAll();
    cb1.mockClear();
    cb2.mockClear();

    await fs.writeFile(file1, 'changed');
    await fs.writeFile(file2, 'changed');
    // Nothing is watching any more, so no amount of waiting can produce a
    // callback — this observation window is safe to keep short.
    await new Promise((r) => setTimeout(r, 120));

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  }, 20_000);

  /**
   * TEST-20 follow-up — regression guard for a real source race.
   *
   * `_poll` awaits `readdir`/`stat` and only then invokes the callback, but it
   * captured `entry` directly and never re-checked that the watcher was still
   * registered. `unwatch()` clears the interval, so no *new* poll starts — yet a
   * poll already past its `stat` still delivered its callback afterwards. On a
   * fast disk that window is under a millisecond, which is why `unwatches a
   * specific path` and `unwatchAll stops all watchers` never caught it; hold
   * `fs.stat` open and it is deterministic.
   *
   * This is not a test artefact: `RoutineManager.stopAll()` is what the daemon
   * calls on shutdown, so the stray callback submits a routine task into an
   * orchestrator that is already tearing down.
   */
  it('drops a callback from a poll already in flight when the watcher is stopped', async () => {
    const filePath = path.join(testDir, 'inflight.txt');
    await fs.writeFile(filePath, 'v1');

    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 20 });
    manager.watch(filePath, 0, callback);

    // Give the watcher a baseline and prove it is live before interfering.
    await touchUntilDetected(filePath, () => callback.mock.calls.length > 0, 'the watcher to fire');

    // Park the next poll inside `fs.stat`, after it has read the (now changed)
    // mtime but before it can compare and fire.
    let entered = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realStat = fs.stat.bind(fs);
    const statSpy = vi
      .spyOn(fs, 'stat')
      .mockImplementation(async (target: Parameters<typeof realStat>[0]) => {
        const stat = await realStat(target);
        if (!entered) {
          entered = true;
          await gate;
        }
        return stat;
      });

    try {
      await fs.writeFile(filePath, 'v2');
      await until(() => entered, 'a poll to be parked inside fs.stat');

      callback.mockClear();
      manager.unwatch(filePath);
      release();

      // The parked poll now resumes and reaches its callback site. Nothing else
      // is scheduled, so waiting longer cannot change the outcome.
      await new Promise((r) => setTimeout(r, 100));
      expect(callback).not.toHaveBeenCalled();
    } finally {
      release();
      statSpy.mockRestore();
      manager.unwatchAll();
    }
  }, 20_000);

  it('handles non-existent directory gracefully', async () => {
    const callback = vi.fn();
    const manager = new EventTriggerManager({ pollIntervalMs: 20 });
    manager.watch(path.join(testDir, 'nonexistent', '*.txt'), 0, callback);
    // The directory never comes into existence, so this invariant cannot be
    // broken by waiting longer.
    await new Promise((r) => setTimeout(r, 120));
    expect(callback).not.toHaveBeenCalled();
    manager.unwatchAll();
  });
});
