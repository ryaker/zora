/**
 * Filesystem Utilities — Helper functions for safe I/O.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ERR-22: serialises read-modify-write cycles on a file across processes.
 *
 * `writeAtomic` below makes a single write all-or-nothing, which is a different
 * guarantee from making a read-then-write sequence indivisible. Two agents that
 * both read an inbox of `[A]`, each append their own message and each write
 * atomically produce `[A, B]` and `[A, C]` — both writes are perfectly atomic
 * and one message is gone. That needs a lock, not an atomic write.
 *
 * The lock is a file rather than an in-process mutex because the thing it
 * guards is a filesystem channel between agents: an in-process mutex would fix
 * the case where one process contends with itself and miss the case the file
 * format exists for. `open(..., 'wx')` is atomic — exactly one caller creates
 * the lock, everyone else gets EEXIST and waits.
 *
 * Stale locks: a holder that crashes leaves its lock behind, and a mailbox that
 * deadlocks forever because an agent died is worse than the race this fixes. A
 * lock older than `staleMs` is therefore stolen. That steal is best-effort and
 * not race-free — two waiters can both judge the same lock stale, and the
 * second's `rm` can remove a lock the first has just legitimately taken. It is
 * narrowed by re-checking the holder's identity immediately before removing it,
 * and it only happens at all once a lock is `staleMs` old, which is orders of
 * magnitude beyond how long any operation here holds it.
 */
export async function withFileLock<T>(
  targetPath: string,
  fn: () => Promise<T>,
  options: { timeoutMs?: number; staleMs?: number; pollMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const staleMs = options.staleMs ?? 30_000;
  const pollMs = options.pollMs ?? 15;
  const lockPath = `${targetPath}.lock`;
  // Identifies this holder well enough to tell "the lock I looked at" from "a
  // different lock that replaced it" when deciding whether a steal is still safe.
  const holderId = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

  const deadline = Date.now() + timeoutMs;
  let acquired = false;

  while (!acquired) {
    try {
      await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
      const handle = await fs.promises.open(lockPath, 'wx');
      try {
        await handle.writeFile(holderId, 'utf8');
      } finally {
        await handle.close();
      }
      acquired = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      // Held by someone else. Steal it only if it has gone stale.
      const observed = await readLockHolder(lockPath);
      if (observed !== null) {
        const age = await lockAge(lockPath);
        if (age !== null && age > staleMs) {
          // Re-read immediately before removing: if the holder changed, the
          // lock we judged stale is not the lock that is there now.
          if ((await readLockHolder(lockPath)) === observed) {
            await fs.promises.rm(lockPath, { force: true }).catch(() => { /* lost the race; retry */ });
          }
          continue;
        }
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `withFileLock: timed out after ${timeoutMs}ms waiting for ${lockPath}. ` +
            `Another process is holding it, or a stale lock needs removing by hand.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  try {
    return await fn();
  } finally {
    // Only remove the lock if it is still ours — a steal may have handed it on.
    if ((await readLockHolder(lockPath)) === holderId) {
      await fs.promises.rm(lockPath, { force: true }).catch(() => { /* already gone */ });
    }
  }
}

/** The holder id written into a lock file, or null if it cannot be read. */
async function readLockHolder(lockPath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(lockPath, 'utf8');
  } catch {
    return null;
  }
}

/** Age of a lock file in ms, or null if it is gone. */
async function lockAge(lockPath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(lockPath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Writes a file atomically using the write-then-rename pattern.
 * This prevents data corruption during concurrent access or system crashes.
 */
export async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  
  try {
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    
    // Write to temporary file
    await fs.promises.writeFile(tempPath, content, 'utf8');
    
    // Rename temporary file to target path (atomic operation on most POSIX systems)
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    // Cleanup temporary file if it exists and rename failed
    if (fs.existsSync(tempPath)) {
      try { await fs.promises.unlink(tempPath); } catch {}
    }
    throw err;
  }
}

/**
 * Expands a leading `~` to the user's home directory and returns an absolute path.
 *
 * PROV-10. Config paths like `agent.workspace` are written the way a human types
 * them (`~/work`), and `~` means nothing to any filesystem call — an unexpanded
 * path silently becomes a literal `./~` directory relative to wherever the
 * process happened to start.
 *
 * Returns `fallback` (default: process.cwd()) for an empty/undefined input.
 */
export function expandHome(inputPath?: string, fallback: string = process.cwd()): string {
  if (!inputPath || inputPath.trim().length === 0) return fallback;
  const expanded = inputPath.startsWith('~')
    ? path.join(os.homedir(), inputPath.slice(1))
    : inputPath;
  return path.resolve(expanded);
}
