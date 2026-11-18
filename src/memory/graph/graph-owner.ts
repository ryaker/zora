/**
 * Who holds the graph database — a diagnostic note, not a lock (MEM-35).
 *
 * ## The lock is upstream's, and only upstream's
 *
 * SparrowDB derives its catalog counters (`next_label_id` and friends) from
 * per-handle in-memory state. Two processes that open one database root and both
 * `CREATE` a new label can allocate the same id and corrupt `catalog.tlv` beyond
 * recovery, after which the database cannot be opened at all:
 *
 *     corruption: duplicate label_id 0 in catalog file
 *
 * Upstream measured 4 of 5 concurrent runs doing exactly that, and fixed it in
 * `sparrowdb@0.1.27` (SparrowDB #524): `GraphDb::open` takes an exclusive
 * `flock` on `<root>/db.lock` and refuses a second handle outright. Zora
 * requires `^0.1.27`, so that guard is always present, it binds every writer
 * rather than only the ones that cooperate — the `sparrowdb` CLI and the
 * SparrowDB MCP server included — and the kernel releases it when the holding
 * process exits, crash or not.
 *
 * **So this module deliberately does not lock anything.** An earlier revision
 * held a pid file and refused to start the tier when it looked occupied. That
 * was the right shape while 0.1.26 was the floor and nothing else guarded the
 * root, and the wrong shape afterwards: a hand-rolled lock behind a kernel lock
 * adds no exclusion, but it does add ways to be wrong. A recycled pid reads as
 * live and would disable relational recall for a database nobody holds; a
 * lock written on another host cannot be probed at all; two processes reclaiming
 * one stale file can race. Every one of those failures was a *false positive* —
 * the tier going inert when it needn't — bought for exclusion the kernel was
 * already providing.
 *
 * ## What is left, and why it is worth keeping
 *
 * One thing upstream's error genuinely cannot do is say *who* holds the
 * database. Its message names the path, which the user already knows. The case
 * this actually fires on is `zora-agent ask` while the daemon is running, so
 * naming the holder is the difference between "something has it" and "your
 * daemon has it, pid 4821".
 *
 * A store therefore writes a small note recording its own pid on the way up, and
 * removes it on the way down. The note is read in exactly one place: composing
 * the warning for an open that upstream *already refused*. It gates nothing, so
 * it cannot make the tier inert, and a missing, stale or unreadable note costs
 * only a less specific message.
 *
 * The file is `.zora-graph-owner.json`, deliberately not `db.lock` — that name
 * is upstream's and both files live in the same directory.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('graph-owner');

/** Zora's note inside the database root. Upstream's lock is `db.lock`. */
const OWNER_FILE = '.zora-graph-owner.json';

interface OwnerNote {
  pid: number;
  host: string;
  startedAt: string;
}

export interface GraphOwnerNote {
  /** Remove this process's note. Idempotent; never throws. */
  clear(): void;
}

/**
 * Record this process as the holder of the graph at `root`.
 *
 * Call only after `SparrowDB.open()` has succeeded — the open is what confers
 * ownership, and letting SparrowDB create the directory keeps this module out of
 * the open path entirely. Never throws: a note that cannot be written costs a
 * vaguer warning in another process later, which is not worth failing a boot
 * over.
 */
export function recordGraphOwner(root: string): GraphOwnerNote {
  const file = path.join(path.resolve(root), OWNER_FILE);
  const note: OwnerNote = {
    pid: process.pid,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(file, JSON.stringify(note));
  } catch (err) {
    log.debug({ err, file }, 'Could not record graph database owner; diagnostics only');
  }

  let cleared = false;
  return {
    clear(): void {
      if (cleared) return;
      cleared = true;
      try {
        // Only remove a note that is still ours. Two stores in one process share
        // one note (same pid, so the second write is identical), and the process
        // does still hold the database after the first of them closes — but a
        // note that has since been rewritten by a *different* process describes
        // that process, and deleting it would discard a true fact.
        const current = read(file);
        if (current && current.pid === note.pid && current.host === note.host) {
          fs.unlinkSync(file);
        }
      } catch (err) {
        log.debug({ err, file }, 'Could not clear graph database owner note');
      }
    },
  };
}

/**
 * Describe the process holding the graph at `root`, for an error message.
 *
 * Only meaningful after an open has already been refused. Returns `null` when
 * there is no usable note, so callers fall back to a generic message rather than
 * inventing a holder.
 *
 * A recorded pid that is no longer running is reported as absent rather than as
 * the holder: something holds the `flock` — the open was refused — but a dead
 * pid is not it, and naming it would send the user after the wrong process.
 */
export function describeGraphOwner(root: string): string | null {
  const file = path.join(path.resolve(root), OWNER_FILE);
  const note = read(file);
  if (!note) return null;

  if (note.host !== os.hostname()) {
    // Liveness is unknowable across a network mount, so report it as-is and let
    // the wording carry the uncertainty.
    return `a Zora process on ${note.host} (pid ${note.pid})`;
  }
  if (!isAlive(note.pid)) return null;

  const since = note.startedAt ? `, running since ${note.startedAt}` : '';
  return `another Zora process (pid ${note.pid}${since})`;
}

/**
 * Whether an error from `SparrowDB.open()` is upstream's cross-process lock
 * refusing a second handle (SparrowDB #524, shipped in 0.1.27).
 *
 * Matched on the message because the N-API boundary flattens
 * `Error::DatabaseLocked` to a plain `Error` — there is no code or class to
 * test. The substring is the stable half of upstream's `Display`:
 * `"database locked: another process already has '<path>' open for writing…"`,
 * which upstream's own regression test asserts on.
 *
 * `dialect-contract.test.ts` provokes the real refusal from a real second
 * process and feeds it to this function, so the match is checked against the
 * engine rather than against a copy of the string kept here.
 */
export function isDatabaseLockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes('database locked');
}

function read(file: string): OwnerNote | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<OwnerNote>;
    if (typeof parsed.pid !== 'number' || typeof parsed.host !== 'string') return null;
    return { pid: parsed.pid, host: parsed.host, startedAt: String(parsed.startedAt ?? '') };
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 runs the existence and permission checks without delivering
    // anything.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is not ours to signal — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
