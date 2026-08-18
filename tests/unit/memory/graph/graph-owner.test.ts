/**
 * The graph database owner note (MEM-35).
 *
 * These tests exist to hold one property: **the note must never gate anything.**
 *
 * Exclusion belongs to SparrowDB's `flock` (SparrowDB #524, fixed in 0.1.27).
 * An earlier revision of this module held a pid *lock* and refused to start the
 * graph tier when the file looked occupied — correct while 0.1.26 was the floor
 * and nothing else guarded the root, and wrong once the kernel was doing the
 * job. Every way that lock could be wrong was a false positive: a recycled pid,
 * an unprobeable remote host, two processes reclaiming one stale file. Each
 * would have disabled relational recall for a database nobody held.
 *
 * So what is asserted below is mostly the *absence* of consequences: writing,
 * reading, corrupting and deleting the note all leave behaviour unchanged, and
 * the only observable effect is how precisely a warning can name the holder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  describeGraphOwner,
  isDatabaseLockedError,
  recordGraphOwner,
} from '../../../../src/memory/graph/graph-owner.js';

const OWNER_FILE = '.zora-graph-owner.json';

/**
 * A pid that is certainly not running: above the system maximum, so `kill(0)`
 * reports ESRCH — the same signal the "holder is gone" path reads.
 */
const DEAD_PID = 0x7ffffffe;

describe('recordGraphOwner', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-graph-owner-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const noteFile = (): string => path.join(root, OWNER_FILE);
  const write = (note: Record<string, unknown>): void =>
    fs.writeFileSync(noteFile(), JSON.stringify(note));

  it('records this process, so another one can name it later', () => {
    recordGraphOwner(root);

    const note = JSON.parse(fs.readFileSync(noteFile(), 'utf8')) as Record<string, unknown>;
    expect(note.pid).toBe(process.pid);
    expect(note.host).toBe(os.hostname());
    expect(typeof note.startedAt).toBe('string');
  });

  it('clears the note, idempotently', () => {
    const owner = recordGraphOwner(root);
    owner.clear();
    expect(fs.existsSync(noteFile())).toBe(false);

    owner.clear();
    expect(fs.existsSync(noteFile())).toBe(false);
  });

  it('does not delete a note that now describes a different process', () => {
    const owner = recordGraphOwner(root);

    // Another process rewrote the note while we were alive. It is a true fact
    // about that process; discarding it would lose the only diagnostic there is.
    write({ pid: process.ppid, host: os.hostname(), startedAt: '' });
    owner.clear();

    expect(fs.existsSync(noteFile())).toBe(true);
    const note = JSON.parse(fs.readFileSync(noteFile(), 'utf8')) as Record<string, unknown>;
    expect(note.pid).toBe(process.ppid);
  });

  it('overwrites an existing note rather than refusing to record', () => {
    // The engine already decided this process may open the database. A note
    // left by anyone else — a crashed predecessor, or another store in this same
    // process — must not turn into a reason to withhold ours.
    write({ pid: process.ppid, host: os.hostname(), startedAt: '' });
    recordGraphOwner(root);

    const note = JSON.parse(fs.readFileSync(noteFile(), 'utf8')) as Record<string, unknown>;
    expect(note.pid).toBe(process.pid);
  });

  it('never throws when the note cannot be written', () => {
    // A read-only or otherwise uncooperative directory costs a vaguer warning
    // somewhere else. It must not cost the graph tier.
    const notADirectory = path.join(root, 'file.txt');
    fs.writeFileSync(notADirectory, 'x');

    expect(() => recordGraphOwner(path.join(notADirectory, 'graph.db')).clear()).not.toThrow();
  });
});

describe('describeGraphOwner', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zora-graph-owner-d-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const write = (note: Record<string, unknown>): void =>
    fs.writeFileSync(path.join(root, OWNER_FILE), JSON.stringify(note));

  it('names a live local holder and when it started', () => {
    // The whole point: `zora-agent ask` while the daemon is running should say
    // which process has the database, not just repeat the path back.
    write({ pid: process.ppid, host: os.hostname(), startedAt: '2026-08-17T00:00:00.000Z' });

    const described = describeGraphOwner(root);
    expect(described).toContain(String(process.ppid));
    expect(described).toContain('2026-08-17T00:00:00.000Z');
  });

  it('declines to name a holder whose process is gone', () => {
    // Something holds the lock — the caller only asks after being refused — but
    // a dead pid is not it, and naming it would send the user hunting a process
    // that does not exist.
    write({ pid: DEAD_PID, host: os.hostname(), startedAt: '' });
    expect(describeGraphOwner(root)).toBeNull();
  });

  it('reports a remote host without claiming to have probed it', () => {
    write({ pid: 4821, host: 'some-other-box', startedAt: '' });

    const described = describeGraphOwner(root);
    expect(described).toContain('some-other-box');
    expect(described).toContain('4821');
  });

  it('returns null for a missing, malformed or partial note', () => {
    expect(describeGraphOwner(root)).toBeNull();

    fs.writeFileSync(path.join(root, OWNER_FILE), 'not json at all');
    expect(describeGraphOwner(root)).toBeNull();

    write({ host: os.hostname() }); // no pid
    expect(describeGraphOwner(root)).toBeNull();
  });

  it('returns null for a root that does not exist', () => {
    expect(describeGraphOwner(path.join(root, 'nope', 'graph.db'))).toBeNull();
  });
});

describe('isDatabaseLockedError', () => {
  it("recognises SparrowDB's cross-process lock refusal", () => {
    // The exact Display text of `Error::DatabaseLocked`, which shipped in 0.1.27
    // and reaches JS as a plain Error with no code to test.
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
    // These must keep reaching the generic warning, which logs the error object.
    // Reporting a permissions problem as "another process holds it" would send
    // the user looking for a process that does not exist.
    expect(isDatabaseLockedError(new Error('EACCES: permission denied'))).toBe(false);
    expect(isDatabaseLockedError(new Error('corruption: duplicate label_id 0'))).toBe(false);
    expect(isDatabaseLockedError('some string')).toBe(false);
  });
});
