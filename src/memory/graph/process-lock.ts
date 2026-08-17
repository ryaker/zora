/**
 * Best-effort single-writer guard over a SparrowDB database root (MEM-35).
 *
 * ## Why this exists
 *
 * SparrowDB derives its catalog counters (`next_label_id` and friends) from
 * per-handle in-memory state. Two processes that open the same database root
 * and both `CREATE` a new label can allocate the same id and corrupt
 * `catalog.tlv` beyond recovery, after which the database cannot be opened at
 * all:
 *
 *     corruption: duplicate label_id 0 in catalog file
 *
 * Upstream measured 4 of 5 concurrent runs left the database permanently
 * unopenable, and documented it as a release-blocking defect against
 * `sparrowdb@0.1.26` (SparrowDB #524). Zora is exposed to exactly the shape the
 * upstream warning calls out — "a CLI invoked while a daemon is running":
 * `zora-agent daemon` holds a graph worker for its whole lifetime, and every
 * other `zora-agent` invocation boots its own Orchestrator, hence its own
 * `GraphStore.open()`, against the same `ZORA_GRAPH_MEMORY_PATH`.
 *
 * ## This is the second line of defence, not the first
 *
 * `sparrowdb@0.1.27` fixed it properly: `GraphDb::open` takes an exclusive
 * `flock` on `<root>/db.lock` and returns `Error::DatabaseLocked` rather than
 * handing out a second handle. That is strictly better than anything reachable
 * from JS — the kernel releases `flock`, so a SIGKILLed holder leaves nothing to
 * reclaim, and it binds every writer rather than only the ones that opt in.
 * Zora's package range is `^0.1.27`, so it is always present.
 *
 * This module is kept behind it for two narrow reasons, and it is worth being
 * honest that they are narrow:
 *
 *   1. **`flock` is not reliable on every filesystem.** Over NFS it degrades to
 *      advisory-at-best or a silent no-op depending on the mount, and
 *      `~/.zora/memory/` on a network home directory is an ordinary setup. A
 *      pid file plus a liveness probe fails differently, so the two do not fail
 *      together.
 *   2. **It can name the holder.** Upstream's message reports the path; this one
 *      reports the pid, which is what a user actually needs to act on.
 *
 * Node exposes no `flock`, so the mechanism here is the portable substitute: an
 * exclusively-created PID file plus a liveness probe on the recorded pid. The
 * gap that leaves, stated plainly rather than papered over:
 *
 *   - **Pid reuse.** A stale lock whose pid has since been reused by an
 *     unrelated process reads as live, and the graph tier stays inert until the
 *     file is removed. That fails safe (no corruption), so it is the direction
 *     to err in.
 *   - **A race between two simultaneous reclaims.** Two processes can both
 *     observe the same stale lock, both unlink it, and both create it — the
 *     window is microseconds and requires the previous holder to have crashed,
 *     but it is real.
 *   - **Any writer that is not Zora** — the sparrowdb CLI, the SparrowDB MCP
 *     server, another tool — does not take this lock and is not stopped by it.
 *
 * On 0.1.27 all three are already covered by upstream's `flock`, which is why
 * this module is allowed to have them: {@link isDatabaseLockedError} recognises
 * that refusal and `GraphStore.open` routes it to the same inert path, so the
 * two guards stack rather than compete. The lock file is deliberately **not**
 * named `db.lock` — that name is upstream's, and both files now live in the
 * same directory. This one is Zora's and is named accordingly.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('graph-lock');

/** Zora's lock file inside the database root. Upstream's is `db.lock`. */
const LOCK_FILE = '.zora-graph.lock';

/** What we write into the lock file, so a stale holder can be identified. */
interface LockRecord {
  pid: number;
  host: string;
  startedAt: string;
}

export interface GraphLock {
  /** Absolute path of the lock file. */
  readonly file: string;
  /** Release this handle. Idempotent; the file is removed at the last release. */
  release(): void;
}

export type GraphLockResult =
  | { acquired: true; lock: GraphLock }
  | { acquired: false; reason: string };

/**
 * Same-process registry, keyed by resolved database root.
 *
 * Mirrors upstream's process-local registry: a second `open()` of the same root
 * from *this* process shares the existing lock instead of deadlocking against
 * it. Only genuinely separate processes contend.
 */
const held = new Map<string, { record: LockRecord; file: string; refs: number }>();

/** Drop every same-process lock without touching disk. Test-only. */
export function resetGraphLockRegistry(): void {
  held.clear();
}

/**
 * Claim `root` for this process.
 *
 * Never throws. A filesystem that will not cooperate — a read-only mount, a
 * path we cannot create — yields `acquired: true` with no lock rather than
 * blocking the tier: the guard is an improvement on unprotected access, not a
 * precondition for it, and refusing to start the graph tier because a lock file
 * could not be written would trade a rare hazard for a common outage.
 */
export function acquireGraphLock(root: string): GraphLockResult {
  const resolved = path.resolve(root);
  const file = path.join(resolved, LOCK_FILE);

  const existing = held.get(resolved);
  if (existing) {
    existing.refs += 1;
    return { acquired: true, lock: makeHandle(resolved, file) };
  }

  const record: LockRecord = {
    pid: process.pid,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch (err) {
    // The directory is SparrowDB's to create; if we cannot, `open()` will fail
    // next and report the real reason. Nothing to guard here.
    log.debug({ err, root: resolved }, 'Could not prepare graph database root for locking');
    return { acquired: true, lock: noopHandle(file) };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 'wx' is the whole mechanism: an atomic create-or-fail. Two processes
      // racing here cannot both succeed.
      fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx' });
      held.set(resolved, { record, file, refs: 1 });
      return { acquired: true, lock: makeHandle(resolved, file) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        log.debug({ err, file }, 'Graph lock file could not be written; continuing unguarded');
        return { acquired: true, lock: noopHandle(file) };
      }
    }

    const holder = readLock(file);

    // A lock this very process already owns. Upstream's registry deliberately
    // allows a second same-process `open()`, and so must this: the `held` map
    // above is per-*thread* — worker threads get their own module instances —
    // while `process.pid` is shared, so the daemon's graph worker and anything
    // else inside the same process would otherwise turn each other away. The
    // file stays owned by whichever thread created it.
    if (holder && holder.pid === process.pid && holder.host === os.hostname()) {
      return { acquired: true, lock: noopHandle(file) };
    }

    if (holder && isHolderLive(holder)) {
      return { acquired: false, reason: describeHolder(holder, file) };
    }

    // Stale (or unparseable): the recorded process is gone. Reclaim it once —
    // the loop runs at most twice, so a lock that keeps reappearing belongs to
    // a live racer and is reported as held rather than fought over.
    try {
      fs.unlinkSync(file);
    } catch {
      // Someone else reclaimed it first; the next attempt will see their file.
    }
  }

  const holder = readLock(file);
  return {
    acquired: false,
    reason: holder
      ? describeHolder(holder, file)
      : `another process is contending for the graph lock at ${file}`,
  };
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

function makeHandle(resolved: string, file: string): GraphLock {
  let released = false;
  return {
    file,
    release(): void {
      if (released) return;
      released = true;
      const entry = held.get(resolved);
      if (!entry) return;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      held.delete(resolved);
      // Only remove a file we still own. A lock reclaimed as stale while we
      // were alive belongs to someone else now, and unlinking it would hand a
      // third process a database two others are already holding.
      const current = readLock(entry.file);
      if (current && current.pid === entry.record.pid && current.host === entry.record.host) {
        try {
          fs.unlinkSync(entry.file);
        } catch (err) {
          log.debug({ err, file: entry.file }, 'Could not remove graph lock file');
        }
      }
    },
  };
}

/** A handle over a lock we never took, so callers need not branch. */
function noopHandle(file: string): GraphLock {
  return { file, release: () => {} };
}

function readLock(file: string): LockRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockRecord>;
    if (typeof parsed.pid !== 'number' || typeof parsed.host !== 'string') return null;
    return { pid: parsed.pid, host: parsed.host, startedAt: String(parsed.startedAt ?? '') };
  } catch {
    return null;
  }
}

function isHolderLive(holder: LockRecord): boolean {
  // A lock written on another machine — a home directory on a network mount —
  // cannot be probed for liveness from here, so it is assumed live. Refusing to
  // start is the safe side of that guess.
  if (holder.host !== os.hostname()) return true;
  try {
    // Signal 0 performs the permission and existence checks without delivering
    // anything.
    process.kill(holder.pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is not ours to signal — still live.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function describeHolder(holder: LockRecord, file: string): string {
  const where = holder.host === os.hostname() ? `pid ${holder.pid}` : `pid ${holder.pid} on ${holder.host}`;
  const since = holder.startedAt ? ` since ${holder.startedAt}` : '';
  return (
    `another Zora process (${where}) already has this graph database open${since} ` +
    `— SparrowDB allows one writer per database root, and concurrent writers can ` +
    `permanently corrupt it (SparrowDB #524). Lock file: ${file}`
  );
}
