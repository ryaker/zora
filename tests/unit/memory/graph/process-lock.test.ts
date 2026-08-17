/**
 * Single-writer guard over the graph database root (MEM-35).
 *
 * The hazard is not a lost write: two processes on one SparrowDB root can leave
 * `catalog.tlv` permanently unopenable (SparrowDB #524). The guard must
 * therefore be strict about the case it exists for — a live holder in another
 * process — and forgiving about everything else, because refusing to start an
 * optional, off-by-default memory tier over a lock file is a worse trade than
 * the hazard it avoids.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireGraphLock,
  isDatabaseLockedError,
  resetGraphLockRegistry,
} from '../../../../src/memory/graph/process-lock.js';

const LOCK_FILE = '.zora-graph.lock';

/**
 * A pid that is certainly not running.
 *
 * Allocated by taking a real pid and freeing it is not available here, so use
 * a value above the system maximum: `kill(0)` on it reports ESRCH, which is
 * exactly the "holder is gone" signal the reclaim path reads.
 */
const DEAD_PID = 0x7ffffffe;

describe('acquireGraphLock', () => {
  let root: string;

  beforeEach(async () => {
    resetGraphLockRegistry();
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-graph-lock-'));
  });

  afterEach(async () => {
    resetGraphLockRegistry();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const lockFile = (): string => path.join(root, LOCK_FILE);
  const writeHolder = (holder: Record<string, unknown>): void =>
    fs.writeFileSync(lockFile(), JSON.stringify(holder));

  it('claims an unlocked root and writes an identifiable record', () => {
    const result = acquireGraphLock(root);
    expect(result.acquired).toBe(true);

    const record = JSON.parse(fs.readFileSync(lockFile(), 'utf8')) as Record<string, unknown>;
    expect(record.pid).toBe(process.pid);
    expect(record.host).toBe(os.hostname());
  });

  it('creates the database root if it does not exist yet', () => {
    const fresh = path.join(root, 'nested', 'graph.db');
    expect(acquireGraphLock(fresh).acquired).toBe(true);
    expect(fs.existsSync(path.join(fresh, LOCK_FILE))).toBe(true);
  });

  it('refuses a root held by a live process elsewhere', () => {
    // `process.ppid` is a real, live process that is not this one — the
    // situation the guard exists for, without spawning anything.
    writeHolder({ pid: process.ppid, host: os.hostname(), startedAt: '2026-08-17T00:00:00.000Z' });

    const result = acquireGraphLock(root);
    expect(result.acquired).toBe(false);
    // The warning is the user's only signal that relational recall went away,
    // so it has to say who holds it and where.
    expect(result.acquired === false && result.reason).toContain(String(process.ppid));
    expect(result.acquired === false && result.reason).toContain(LOCK_FILE);
  });

  it('reclaims a lock whose holder is gone', () => {
    writeHolder({ pid: DEAD_PID, host: os.hostname(), startedAt: '2026-08-17T00:00:00.000Z' });

    const result = acquireGraphLock(root);
    expect(result.acquired).toBe(true);

    const record = JSON.parse(fs.readFileSync(lockFile(), 'utf8')) as Record<string, unknown>;
    expect(record.pid).toBe(process.pid);
  });

  it('reclaims an unparseable lock file rather than deadlocking on it', () => {
    fs.writeFileSync(lockFile(), 'not json at all');
    expect(acquireGraphLock(root).acquired).toBe(true);
  });

  it('treats a lock written on another host as held', () => {
    // Liveness cannot be probed across a network mount, and guessing "gone"
    // there is the guess that corrupts the database.
    writeHolder({ pid: process.pid, host: `${os.hostname()}-elsewhere`, startedAt: '' });

    const result = acquireGraphLock(root);
    expect(result.acquired).toBe(false);
    expect(result.acquired === false && result.reason).toContain('elsewhere');
  });

  it('lets the same process open the same root twice', () => {
    // Upstream's own lock allows this via a process-local registry, and Zora
    // needs it for the same reason: worker threads share a pid.
    const first = acquireGraphLock(root);
    const second = acquireGraphLock(root);
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(true);
  });

  it('holds the lock until the last same-process handle releases', () => {
    const first = acquireGraphLock(root);
    const second = acquireGraphLock(root);
    if (!first.acquired || !second.acquired) throw new Error('setup: both acquires must succeed');

    first.lock.release();
    expect(fs.existsSync(lockFile())).toBe(true);
    second.lock.release();
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  it('releases idempotently', () => {
    const result = acquireGraphLock(root);
    if (!result.acquired) throw new Error('setup: acquire must succeed');
    result.lock.release();
    result.lock.release();
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  it('frees a released root for the next claimant', () => {
    const first = acquireGraphLock(root);
    if (!first.acquired) throw new Error('setup: acquire must succeed');
    first.lock.release();

    resetGraphLockRegistry(); // simulate a fresh process
    expect(acquireGraphLock(root).acquired).toBe(true);
  });

  it('does not delete a lock file that has been taken over by someone else', () => {
    const result = acquireGraphLock(root);
    if (!result.acquired) throw new Error('setup: acquire must succeed');

    // Our lock was reclaimed as stale while we were alive; the file is now
    // someone else's. Unlinking it on our release would hand a third process a
    // database two others already hold.
    writeHolder({ pid: process.ppid, host: os.hostname(), startedAt: '' });
    result.lock.release();

    expect(fs.existsSync(lockFile())).toBe(true);
    const record = JSON.parse(fs.readFileSync(lockFile(), 'utf8')) as Record<string, unknown>;
    expect(record.pid).toBe(process.ppid);
  });

  it('continues unguarded rather than failing when the root cannot be locked', () => {
    // A path that cannot be a directory: the guard is an improvement on
    // unprotected access, not a precondition for it.
    const notADirectory = path.join(root, 'file.txt');
    fs.writeFileSync(notADirectory, 'x');

    expect(acquireGraphLock(path.join(notADirectory, 'graph.db')).acquired).toBe(true);
  });
});

describe('isDatabaseLockedError', () => {
  it("recognises upstream's cross-process lock refusal", () => {
    // The exact Display text of SparrowDB's `Error::DatabaseLocked`, which
    // shipped in 0.1.27 and reaches JS as a plain Error with no code to test.
    // `dialect-contract.test.ts` checks this same match against a refusal
    // provoked from a real second process; this case pins the string itself.
    const err = new Error(
      "database locked: another process already has '/home/u/.zora/memory/graph.db' open for " +
        'writing. SparrowDB allows only one open handle per database root at a time — close the ' +
        "other process's connection (or wait for it to exit) and retry.",
    );
    expect(isDatabaseLockedError(err)).toBe(true);
  });

  it('does not swallow unrelated open failures', () => {
    // These must keep reaching the generic warning, which logs the error
    // object; reporting a permissions problem as "another process holds it"
    // would send the user looking for a process that does not exist.
    expect(isDatabaseLockedError(new Error('EACCES: permission denied'))).toBe(false);
    expect(isDatabaseLockedError(new Error('corruption: duplicate label_id 0'))).toBe(false);
    expect(isDatabaseLockedError('some string')).toBe(false);
  });
});
