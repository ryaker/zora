import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// We can't easily test the exported program from src/cli/index.ts 
// because it calls program.parse() immediately.
// For v1, we'll verify the utility function writeAtomic.

import { writeAtomic, withFileLock } from '../../../src/utils/fs.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Filesystem Utilities', () => {
  const testDir = path.join(os.tmpdir(), 'zora-utils-test');
  const testFile = path.join(testDir, 'atomic.txt');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('performs atomic writes', async () => {
    await writeAtomic(testFile, 'atomic content');
    expect(fs.readFileSync(testFile, 'utf8')).toBe('atomic content');
  });

  it('overwrites existing files atomically', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, 'old content');
    
    await writeAtomic(testFile, 'new content');
    expect(fs.readFileSync(testFile, 'utf8')).toBe('new content');
  });
});

/**
 * ERR-22 — the lock that makes read-modify-write cycles indivisible.
 *
 * `writeAtomic` guarantees a single write is all-or-nothing. That is a
 * different guarantee from making a read-then-write sequence indivisible, and
 * the Mailbox needed the second one.
 */
describe('withFileLock', () => {
  const lockDir = path.join(os.tmpdir(), `zora-lock-test-${process.pid}`);
  const target = path.join(lockDir, 'guarded.json');

  beforeEach(() => {
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.mkdirSync(lockDir, { recursive: true });
  });

  it('serialises overlapping critical sections', async () => {
    // Each section reads a counter, yields, then writes it back — the shape
    // that loses updates without a lock. `concurrent` records whether any two
    // sections were ever inside at the same time.
    let inside = 0;
    let concurrent = false;
    let counter = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        withFileLock(target, async () => {
          inside++;
          if (inside > 1) concurrent = true;
          const read = counter;
          await new Promise((r) => setTimeout(r, 1));
          counter = read + 1;
          inside--;
        }),
      ),
    );

    expect(concurrent).toBe(false);
    expect(counter).toBe(20);
  }, 30_000);

  it('releases the lock when the critical section throws', async () => {
    await expect(
      withFileLock(target, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // A lock leaked on the error path would deadlock every later caller, so
    // the next acquisition is the assertion.
    await expect(withFileLock(target, async () => 'ok')).resolves.toBe('ok');
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  }, 30_000);

  it('steals a lock left behind by a crashed holder', async () => {
    // A process that dies mid-section leaves its lock file forever. Without
    // stale-stealing the mailbox would be wedged until someone deleted it by
    // hand — worse than the race the lock exists to fix.
    fs.writeFileSync(`${target}.lock`, '999999:0:deadbeef', 'utf8');

    await expect(
      withFileLock(target, async () => 'recovered', { staleMs: 0, timeoutMs: 5_000 }),
    ).resolves.toBe('recovered');
  }, 30_000);

  it('times out rather than waiting forever on a live lock', async () => {
    // staleMs is high, so this lock is "held", not "abandoned". The caller must
    // be told, not blocked indefinitely.
    fs.writeFileSync(`${target}.lock`, `${process.pid}:${Date.now()}:live`, 'utf8');

    await expect(
      withFileLock(target, async () => 'should not run', { timeoutMs: 100, staleMs: 3_600_000 }),
    ).rejects.toThrow(/timed out/);
  }, 30_000);
});

/**
 * ERR-22 follow-up — the steal path under contention.
 *
 * Review finding on #179: the original steal was a check-then-delete, and two
 * waiters could both remove and both acquire, so both ran the critical section.
 * The existing coverage could not see it — every steal test was single-actor,
 * and the 25-sender contention test contends on a *live* lock, so the steal
 * path never ran with more than one actor in it. These tests put several
 * waiters on a genuinely abandoned lock, which is the shape that fails.
 */
/** Stale threshold well above how long any critical section here runs. */
const STALE_MS = 5_000;

/** Writes a lock file and backdates it so it reads as genuinely abandoned. */
function abandonLock(lockPath: string): void {
  fs.writeFileSync(lockPath, '999999:0:crashed', 'utf8');
  const wellPast = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, wellPast, wellPast);
}

describe('withFileLock — concurrent recovery of an abandoned lock', () => {
  const lockDir = path.join(os.tmpdir(), `zora-lock-steal-${process.pid}`);
  const target = path.join(lockDir, 'contended.json');

  beforeEach(() => {
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.mkdirSync(lockDir, { recursive: true });
  });

  it('admits exactly one waiter at a time when several recover the same lock', async () => {
    // A holder that died: a lock file nobody will ever release, backdated so it
    // is stale under a realistic threshold. `staleMs: 0` would be no test at
    // all — it makes every lock instantly stale, including the live one a
    // waiter has just acquired, so no configuration could exclude anybody.
    abandonLock(`${target}.lock`);

    let inside = 0;
    let everConcurrent = false;
    let counter = 0;

    // All waiters start together and all judge the same lock stale, which is
    // what puts two of them in the steal path at once.
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withFileLock(
          target,
          async () => {
            inside++;
            if (inside > 1) everConcurrent = true;
            // An await inside the section: without real exclusion, a second
            // holder interleaves here and the increment is lost.
            const read = counter;
            await new Promise((r) => setTimeout(r, 2));
            counter = read + 1;
            inside--;
          },
          { staleMs: STALE_MS, timeoutMs: 10_000 },
        ),
      ),
    );

    expect(everConcurrent, 'two waiters held the same lock at once').toBe(false);
    // The lost-update symptom the lock exists to prevent, stated directly.
    expect(counter).toBe(8);
  }, 30_000);

  /**
   * The deterministic guard for the review finding.
   *
   * The multi-waiter test above asserts mutual exclusion in general, but it
   * cannot reliably reproduce the double-steal: it needs two waiters to both
   * clear the holder re-check before either acquires, and one waiter's
   * re-check-to-delete gap is a single microtask while the other needs several
   * I/O round trips to acquire. Verified by reverting the fix — the 8-waiter
   * test still passed. So instead of racing for the bug, this pins the
   * mechanism that makes it impossible: the decision to remove a stale lock is
   * taken under an exclusive marker, and a waiter that cannot hold that marker
   * must not remove anything.
   */
  it('does not steal a stale lock while another waiter is recovering it', async () => {
    abandonLock(`${target}.lock`);
    // A recovery in progress by someone else, fresh enough not to be abandoned.
    fs.writeFileSync(`${target}.lock.recover`, 'another-waiter', 'utf8');

    await expect(
      withFileLock(target, async () => 'acquired', { staleMs: STALE_MS, timeoutMs: 300 }),
    ).rejects.toThrow(/timed out/);

    // The stale lock is still there: removing it was not this waiter's to do.
    expect(fs.existsSync(`${target}.lock`)).toBe(true);
  }, 30_000);

  /**
   * The other side of that: a waiter that dies mid-recovery must not wedge the
   * lock permanently. An aged marker is cleared so recovery can proceed.
   */
  it('clears an abandoned recovery marker instead of blocking recovery forever', async () => {
    abandonLock(`${target}.lock`);
    abandonLock(`${target}.lock.recover`);

    await expect(
      withFileLock(target, async () => 'acquired', { staleMs: STALE_MS, timeoutMs: 10_000 }),
    ).resolves.toBe('acquired');
    expect(fs.existsSync(`${target}.lock.recover`)).toBe(false);
  }, 30_000);

  /**
   * ERR-22 (review finding): the marker was created with `wx` but carried no
   * holder id, so cleanup removed whatever marker happened to be there. A
   * waiter whose own marker had aged out could therefore delete a live one and
   * let a second waiter into the recovery region — reopening the double-steal
   * this mechanism closes. It now carries the holder id and is only removed
   * when it still matches.
   */
  it('does not remove a recovery marker belonging to someone else', async () => {
    abandonLock(`${target}.lock`);
    // A live marker owned by another waiter, written after ours would have been.
    fs.writeFileSync(`${target}.lock.recover`, 'another-waiter-holder-id', 'utf8');

    await expect(
      withFileLock(target, async () => 'acquired', { staleMs: STALE_MS, timeoutMs: 300 }),
    ).rejects.toThrow(/timed out/);

    // Still theirs, byte for byte.
    expect(fs.readFileSync(`${target}.lock.recover`, 'utf8')).toBe('another-waiter-holder-id');
  }, 30_000);

  it('leaves no recovery marker behind once recovery is done', async () => {
    abandonLock(`${target}.lock`);

    await Promise.all(
      Array.from({ length: 4 }, () =>
        withFileLock(target, async () => {}, { staleMs: STALE_MS, timeoutMs: 10_000 }),
      ),
    );

    // A leaked marker blocks all future recovery, turning a crashed holder
    // into a permanently wedged lock.
    expect(fs.existsSync(`${target}.lock.recover`)).toBe(false);
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  }, 30_000);
});
