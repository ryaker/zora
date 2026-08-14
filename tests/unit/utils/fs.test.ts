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
