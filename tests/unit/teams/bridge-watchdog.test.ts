import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BridgeWatchdog } from '../../../src/teams/bridge-watchdog.js';
import type { GeminiBridge } from '../../../src/teams/gemini-bridge.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * TEST-20: the restart tests used to sit on real `setTimeout` sleeps (1.6 s and
 * 5 s) waiting out the watchdog's own exponential backoff — 6.7 s for the file,
 * the slowest in the unit suite, and only ~600 ms of slack over the 1 s backoff
 * it was waiting for.
 *
 * The backoff is the only thing worth skipping, so only `setTimeout` is faked.
 * The health-check `setInterval`, `Date`, and every filesystem call stay real,
 * so the watchdog's staleness arithmetic and its I/O are exercised exactly as
 * before; the test just advances the backoff clock instead of living through
 * it. Faking setTimeout means the test cannot sleep either, hence the captured
 * real timer below.
 */
const realSetTimeout = globalThis.setTimeout;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    realSetTimeout(resolve, ms);
  });
}

/**
 * Polls a condition against a real-clock deadline. Load makes it slower, not
 * wrong. The deadline is a failure bound, not a wait — every step it guards
 * completes in tens of milliseconds on an unloaded box — so it is set just
 * under the test timeout to leave room for a genuinely starved disk while
 * still failing with a message that names what never happened.
 */
async function until(
  predicate: () => boolean,
  label: string,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (performance.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await realSleep(5);
  }
}

describe('BridgeWatchdog', () => {
  const testDir = path.join(os.tmpdir(), `zora-watchdog-test-${process.pid}-${Date.now()}`);
  const stateDir = path.join(testDir, 'state');
  let mockBridge: GeminiBridge;

  const stopCalls = () => vi.mocked(mockBridge.stop).mock.calls.length;
  const startCalls = () => vi.mocked(mockBridge.start).mock.calls.length;

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    mockBridge = {
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(true),
      setOnPollComplete: vi.fn(),
    } as unknown as GeminiBridge;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('writes heartbeat file on start', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, { healthCheckIntervalMs: 10000, maxStaleMs: 50000, maxRestarts: 3, stateDir });
    await watchdog.start();
    watchdog.stop();
    const healthFile = path.join(stateDir, 'bridge-health.json');
    const content = JSON.parse(await fs.readFile(healthFile, 'utf8'));
    expect(content.lastHeartbeat).toBeDefined();
    expect(new Date(content.lastHeartbeat).getTime()).toBeGreaterThan(0);
  });

  it('writeHeartbeat updates timestamp', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, { healthCheckIntervalMs: 10000, maxStaleMs: 50000, maxRestarts: 3, stateDir });
    await watchdog.start();
    const healthFile = path.join(stateDir, 'bridge-health.json');
    const first = JSON.parse(await fs.readFile(healthFile, 'utf8'));
    await realSleep(10);
    await watchdog.writeHeartbeat();
    const second = JSON.parse(await fs.readFile(healthFile, 'utf8'));
    expect(new Date(second.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(new Date(first.lastHeartbeat).getTime());
    watchdog.stop();
  });

  // The explicit timeouts on the two restart tests are failure deadlines, not
  // waits: both finish in ~0.4s. They are generous because every step here is
  // real filesystem I/O against a contended disk during a full-suite run, and
  // the default 5s budget is close enough to be hit by I/O latency alone.
  it('detects stale heartbeat and restarts bridge', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const watchdog = new BridgeWatchdog(mockBridge, { healthCheckIntervalMs: 30, maxStaleMs: 50, maxRestarts: 5, stateDir });
    await watchdog.start();

    // The heartbeat goes stale on its own — nothing is refreshing it.
    await until(() => stopCalls() >= 1, 'the stale heartbeat to stop the bridge');

    // The restart is deferred by the first backoff step (1s), not immediate.
    expect(mockBridge.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(mockBridge.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    await until(() => startCalls() >= 1, 'the bridge to be restarted after the backoff');
    watchdog.stop();

    expect(mockBridge.stop).toHaveBeenCalled();
    expect(mockBridge.start).toHaveBeenCalled();
  }, 30_000);

  it('stops after max restarts exceeded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const watchdog = new BridgeWatchdog(mockBridge, { healthCheckIntervalMs: 30, maxStaleMs: 20, maxRestarts: 2, stateDir });
    await watchdog.start();

    // Restart 1 — backoff 1s.
    await until(() => stopCalls() >= 1, 'the first restart attempt');
    await vi.advanceTimersByTimeAsync(1000);
    await until(() => startCalls() >= 1, 'the bridge to come back after restart 1');

    // Restart 2 — backoff doubles to 2s.
    await until(() => stopCalls() >= 2, 'the second restart attempt');
    expect(startCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(startCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    await until(() => startCalls() >= 2, 'the bridge to come back after restart 2');

    // maxRestarts is 2, so the next stale check must give up instead of
    // restarting a third time. A third attempt would call bridge.stop() again
    // within one health-check interval (30ms), so this window is generous; and
    // once the watchdog has given up the counts can never move again, so
    // waiting longer could not change the outcome.
    await realSleep(300);
    expect(stopCalls()).toBe(2);
    expect(startCalls()).toBe(2);
    // And no backoff sleep is in flight that would bring the bridge back later:
    // a third attempt would have to be waiting on a timer, and there is none to fire.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stopCalls()).toBe(2);
    expect(startCalls()).toBe(2);

    watchdog.stop();
  }, 30_000);

  /**
   * TEST-20 regression guard for a real bug this gap uncovered.
   *
   * `writeHeartbeat()` is wired into the bridge's poll-completion callback, so
   * it runs on the bridge's schedule while `_check()` writes the same file on
   * the watchdog's own schedule. With a plain `fs.writeFile` those two can
   * interleave and splice one document into another, e.g.
   * `{ "lastHeartbeat": ..., "restartCount": 0 } "lastRestart": ... }`.
   *
   * The damage is permanent, not transient: `_readState()` answers any read or
   * parse failure with a *fresh* heartbeat, so once the file will not parse,
   * every health check computes an elapsed time of ~0 and the watchdog never
   * restarts the bridge again — it stops watching and says nothing. This was
   * first seen as a bridge-watchdog test that failed roughly twice in 25 runs
   * because the watchdog under test had gone permanently blind.
   */
  it('never leaves the health file half-written under concurrent writes', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, { healthCheckIntervalMs: 10000, maxStaleMs: 50000, maxRestarts: 3, stateDir });
    await watchdog.start();
    const healthFile = path.join(stateDir, 'bridge-health.json');

    // The competing writer is the watchdog's own restart path, which writes a
    // *longer* document (it adds `lastRestart`) with a plain write. Its exact
    // shape is reproduced here rather than provoked through a restart, because
    // the corruption is in the overlap of the two writes, not in the restart:
    // a shorter document landing inside a longer one is what leaves the file
    // unparseable. Only differing lengths can splice, which is why hammering
    // writeHeartbeat() alone never showed it.
    const restartPathWrite = async (): Promise<void> => {
      const doc = JSON.stringify(
        { lastHeartbeat: new Date().toISOString(), restartCount: 1, lastRestart: new Date().toISOString() },
        null,
        2,
      );
      await fs.writeFile(healthFile, doc, 'utf8');
    };

    const corrupt: string[] = [];
    let done = false;
    const reader = (async () => {
      while (!done) {
        try {
          const raw = await fs.readFile(healthFile, 'utf8');
          JSON.parse(raw);
        } catch (err) {
          // A missing file is fine mid-rename; unparseable content is not.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') corrupt.push(String(err));
        }
      }
    })();

    // Both writers in flight at once, many times over.
    const inFlight: Promise<void>[] = [];
    for (let i = 0; i < 40; i++) {
      inFlight.push(watchdog.writeHeartbeat(), restartPathWrite());
    }
    await Promise.all(inFlight);
    done = true;
    await reader;
    watchdog.stop();

    expect(corrupt).toEqual([]);

    // And what survives is a complete, usable state document.
    const finalRaw = await fs.readFile(healthFile, 'utf8');
    const finalState = JSON.parse(finalRaw) as { lastHeartbeat?: string };
    expect(typeof finalState.lastHeartbeat).toBe('string');
    expect(new Date(finalState.lastHeartbeat!).getTime()).toBeGreaterThan(0);
  }, 30_000);

  it('starts and stops cleanly', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, { healthCheckIntervalMs: 10000, maxStaleMs: 50000, maxRestarts: 3, stateDir });
    await watchdog.start();
    watchdog.stop();
    const stopCountBefore = stopCalls();
    await realSleep(100);
    const stopCountAfter = stopCalls();
    expect(stopCountAfter).toBe(stopCountBefore);
  });
});
