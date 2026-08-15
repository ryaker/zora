import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BridgeWatchdog } from '../../../src/teams/bridge-watchdog.js';
import type { SupervisedPoller } from '../../../src/teams/bridge-watchdog.js';
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
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (performance.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await realSleep(5);
  }
}

interface HealthFileShape {
  lastHeartbeat: string;
  restartCount: number;
  lastRestart?: string;
}

describe('BridgeWatchdog', () => {
  const testDir = path.join(os.tmpdir(), `zora-watchdog-test-${process.pid}-${Date.now()}`);
  const stateDir = path.join(testDir, 'state');
  let mockBridge: SupervisedPoller;

  const stopCalls = () => vi.mocked(mockBridge.stop).mock.calls.length;
  const startCalls = () => vi.mocked(mockBridge.start).mock.calls.length;

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    mockBridge = {
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(true),
      setOnPollComplete: vi.fn(),
    } as unknown as SupervisedPoller;
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

  /**
   * ERR-21 regression guards.
   *
   * The watchdog's only job is to notice that a heartbeat has stopped. Before
   * this fix, every way of *failing to read* the heartbeat was answered with a
   * freshly minted one, so the staleness branch became unreachable and the
   * watchdog went permanently blind without throwing or logging.
   *
   * Each case below damages the health file in a different way and asserts the
   * bridge is still restarted. They are driven through the real timer path
   * rather than by calling `_check()` directly: a test that reaches past the
   * public surface would keep passing if the wiring between the interval and
   * the check were removed. `maxStaleMs` is deliberately large — larger than
   * the whole test — so that a restart can only be explained by the unreadable
   * file, never by elapsed time. Under the old code every one of these hangs
   * until the deadline.
   */
  describe('fails closed when the health file cannot be read (ERR-21)', () => {
    const healthFile = () => path.join(stateDir, 'bridge-health.json');

    /**
     * Starts a watchdog whose heartbeat could never go stale on its own, lets
     * it take one clean check, then applies `damage` and waits for a restart.
     */
    async function expectRestartAfterDamage(damage: () => Promise<void>): Promise<void> {
      const watchdog = new BridgeWatchdog(mockBridge, {
        healthCheckIntervalMs: 20,
        maxStaleMs: 3_600_000,
        maxRestarts: 5,
        stateDir,
      });
      await watchdog.start();
      try {
        // A healthy file must NOT trigger anything: this pins the restart below
        // to the damage rather than to the watchdog restarting indiscriminately.
        await realSleep(100);
        expect(stopCalls()).toBe(0);

        await damage();
        await until(() => stopCalls() >= 1, 'the unreadable health file to stop the bridge');
      } finally {
        watchdog.stop();
      }
    }

    it('restarts the bridge when the health file is unparseable', async () => {
      await expectRestartAfterDamage(async () => {
        // The exact splice shape observed in the wild: one document landing
        // inside another.
        await fs.writeFile(healthFile(), '{"lastHeartbeat":"x","restartCount":0} "lastRestart": }', 'utf8');
      });
    });

    /**
     * The NaN path, which is a distinct hole from an unparseable file: this
     * document is valid JSON, so JSON.parse succeeds and the old code returned
     * it happily. `new Date(undefined).getTime()` is NaN, and `NaN > maxStaleMs`
     * is false, so the watchdog went blind without any read ever failing.
     */
    it('restarts the bridge when lastHeartbeat is absent from valid JSON', async () => {
      await expectRestartAfterDamage(async () => {
        await fs.writeFile(healthFile(), JSON.stringify({ restartCount: 0 }), 'utf8');
      });
    });

    it('restarts the bridge when lastHeartbeat is not a parseable date', async () => {
      await expectRestartAfterDamage(async () => {
        await fs.writeFile(healthFile(), JSON.stringify({ lastHeartbeat: 'banana', restartCount: 0 }), 'utf8');
      });
    });

    it('restarts the bridge when the health file is a directory', async () => {
      // A non-ENOENT errno rather than a content problem — EISDIR on read.
      await expectRestartAfterDamage(async () => {
        await fs.rm(healthFile(), { force: true });
        await fs.mkdir(healthFile(), { recursive: true });
      });
    });

    it('restarts the bridge when the health file disappears', async () => {
      // `start()` wrote this file, so its absence at check time means state was
      // lost — not that the bridge just checked in.
      await expectRestartAfterDamage(async () => {
        await fs.rm(healthFile(), { force: true });
      });
    });
  });

  /**
   * ERR-21: the counterpart to the guards above. `writeHeartbeat()` runs from
   * the bridge's poll-completion callback, so reaching it proves the bridge is
   * alive; it is the one caller allowed to overwrite a damaged file. Healing
   * must not, however, hand the bridge a fresh restart budget by resetting the
   * persisted counter to zero.
   */
  it('heals an unusable health file on the next live heartbeat', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // maxRestarts is 1 so the counter is pinned at exactly 1 rather than merely
    // reaching it: once the budget is spent every later check takes the
    // give-up branch, which cannot increment. That makes the exact assertion
    // below safe against a check landing between the restart and the damage.
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 20,
      maxStaleMs: 20,
      maxRestarts: 1,
      stateDir,
    });
    await watchdog.start();
    const healthFile = path.join(stateDir, 'bridge-health.json');

    // Burn that one restart first, so the persisted counter is non-zero and the
    // assertion below can tell "preserved the count" apart from "wrote a
    // hardcoded 0" — with a fresh watchdog the two are indistinguishable.
    await until(() => stopCalls() >= 1, 'a first restart to put the counter above zero');
    await vi.advanceTimersByTimeAsync(1001);
    await until(() => startCalls() >= 1, 'the bridge to come back from that restart');
    await until(
      async () => (JSON.parse(await fs.readFile(healthFile, 'utf8')) as HealthFileShape).restartCount === 1,
      'the restart to be persisted',
    );
    watchdog.stop();

    // Now damage the file and let a live poll heartbeat heal it.
    await fs.writeFile(healthFile, 'not json at all', 'utf8');
    await watchdog.writeHeartbeat();

    const healed = JSON.parse(await fs.readFile(healthFile, 'utf8')) as HealthFileShape;
    expect(typeof healed.lastHeartbeat).toBe('string');
    expect(Date.now() - new Date(healed.lastHeartbeat).getTime()).toBeLessThan(60_000);
    // Healing must not hand the bridge a fresh budget of restarts.
    expect(healed.restartCount).toBe(1);
  }, 30_000);

  /**
   * ERR-21 follow-up (review finding): the same fail-open in a different
   * costume. A future timestamp parses, so the shape check waved it through;
   * `_check()` then computed a negative elapsed time and `elapsed > maxStaleMs`
   * stayed false until that date arrived. A health file dated next year
   * disabled restart detection for a year, silently.
   */
  it('restarts the bridge when the heartbeat is dated in the future', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 20,
      maxStaleMs: 3_600_000,
      maxRestarts: 5,
      stateDir,
    });
    await watchdog.start();
    try {
      await realSleep(100);
      expect(stopCalls()).toBe(0);

      await fs.writeFile(
        path.join(stateDir, 'bridge-health.json'),
        JSON.stringify({ lastHeartbeat: new Date(Date.now() + 86_400_000 * 365).toISOString(), restartCount: 0 }),
        'utf8',
      );
      await until(() => stopCalls() >= 1, 'the future-dated heartbeat to stop the bridge');
    } finally {
      watchdog.stop();
    }
  }, 30_000);

  /** A clock that stepped slightly forward is not a damaged file. */
  it('tolerates a heartbeat a few seconds ahead of now', async () => {
    const watchdog = new BridgeWatchdog(mockBridge, {
      healthCheckIntervalMs: 20,
      maxStaleMs: 3_600_000,
      maxRestarts: 5,
      stateDir,
    });
    await watchdog.start();
    try {
      await fs.writeFile(
        path.join(stateDir, 'bridge-health.json'),
        JSON.stringify({ lastHeartbeat: new Date(Date.now() + 5_000).toISOString(), restartCount: 0 }),
        'utf8',
      );
      await realSleep(200);
      expect(stopCalls(), 'a 5s clock skew must not read as a damaged file').toBe(0);
    } finally {
      watchdog.stop();
    }
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
