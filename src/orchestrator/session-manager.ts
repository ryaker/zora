/**
 * SessionManager — Persistence for agent work sessions using JSONL.
 *
 * Spec §4.3 "Filesystem Layout":
 *   - sessions/{job-id}.jsonl: Per-job conversation history
 *   - Atomic writes for session history to prevent corruption
 *
 * PERF-02: `listSessions()` used to read every session file in full on every
 * call, which put a dashboard poll (`/api/jobs` + `/api/history`) at
 * O(total bytes on disk). A side-car index (`sessions-index.json`, kept next to
 * the sessions directory) now carries the derived metadata — event count, last
 * activity, status — and is maintained incrementally on every write.
 *
 * The index is a cache, never the source of truth:
 *   - Each entry records the byte size of the `.jsonl` it describes. `listSessions()`
 *     `stat()`s each file and only trusts an entry whose recorded size matches.
 *   - Any mismatch, missing entry, unreadable index, or externally-modified file
 *     falls back to the original full-file scan for that session and re-seeds
 *     the entry. Deleting `sessions-index.json` is always safe.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { writeAtomic } from '../utils/fs.js';

const log = createLogger('session-manager');

/** Derived metadata for one session file. */
interface SessionIndexEntry {
  /** Number of non-blank lines in the .jsonl. */
  eventCount: number;
  /** ISO timestamp of the last parseable event, or null. */
  lastActivity: string | null;
  /** 'completed' | 'failed' | 'running' | 'unknown' */
  status: string;
  /** Byte size of the .jsonl when this entry was computed — the staleness check. */
  size: number;
}

interface SessionIndexFile {
  version: 1;
  sessions: Record<string, SessionIndexEntry>;
}

export interface SessionSummary {
  jobId: string;
  eventCount: number;
  lastActivity: Date | null;
  status: string;
}

/** Derive the session status from an event type, matching the original scan logic. */
function statusForEventType(type: string): string {
  return type === 'done' ? 'completed' : type === 'error' ? 'failed' : 'running';
}

/**
 * BufferedSessionWriter — Batches event writes to reduce disk I/O during streaming.
 *
 * Instead of one file append per event, collects events in memory and flushes
 * to disk periodically (default: every 500ms) or on explicit flush().
 */
export class BufferedSessionWriter {
  private readonly _sessionManager: SessionManager;
  private readonly _jobId: string;
  private readonly _flushIntervalMs: number;
  private _buffer: AgentEvent[] = [];
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _flushing = false;
  private _flushPromise: Promise<void> | null = null;

  /** Max buffered events before dropping oldest (prevents OOM on persistent disk failure). */
  private static readonly MAX_BUFFER_SIZE = 10_000;

  constructor(sessionManager: SessionManager, jobId: string, flushIntervalMs = 500) {
    this._sessionManager = sessionManager;
    this._jobId = jobId;
    this._flushIntervalMs = flushIntervalMs;

    // Start periodic flush
    this._flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Best-effort flush — errors logged by SessionManager
      });
    }, this._flushIntervalMs);
  }

  /** Buffer an event for batched writing. */
  append(event: AgentEvent): void {
    this._buffer.push(event);
    // Drop oldest events if buffer exceeds cap (prevents OOM on sustained disk failure)
    if (this._buffer.length > BufferedSessionWriter.MAX_BUFFER_SIZE) {
      this._buffer = this._buffer.slice(-BufferedSessionWriter.MAX_BUFFER_SIZE);
    }
  }

  /** Flush all buffered events to disk as a single write. */
  async flush(): Promise<void> {
    if (this._buffer.length === 0 || this._flushing) return;

    this._flushing = true;
    const events = this._buffer;
    this._buffer = [];

    const promise = (async () => {
      try {
        // PERF-02: routed through SessionManager so the session index stays in
        // step with the file — one batched append, one index update.
        await this._sessionManager.appendEvents(this._jobId, events);
      } catch (err) {
        log.warn({ jobId: this._jobId, eventCount: events.length, err }, 'Session flush failed, re-buffering events');
        // On write failure, put events back (capped by MAX_BUFFER_SIZE in append)
        this._buffer = [...events, ...this._buffer];
      } finally {
        this._flushing = false;
        this._flushPromise = null;
      }
    })();

    this._flushPromise = promise;
    await promise;
  }

  /** Flush remaining events and stop the timer. Waits for any in-progress flush. */
  async close(): Promise<void> {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    // Wait for any in-progress periodic flush to complete before final flush.
    // Without this, close() could return while a periodic flush is mid-write,
    // causing the final flush() to skip (due to _flushing guard) and lose tail events.
    while (this._flushing) {
      if (this._flushPromise) {
        await this._flushPromise;
      } else {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    // Final flush of any remaining buffered events
    await this.flush();
  }
}

export class SessionManager {
  private readonly _sessionsDir: string;
  private readonly _indexPath: string;

  /** In-memory session index. Populated lazily from disk on first use. */
  private _index: Map<string, SessionIndexEntry> = new Map();
  private _indexLoaded = false;
  private _indexLoadPromise: Promise<void> | null = null;
  private _indexDirty = false;
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  private _persistPromise: Promise<void> | null = null;

  /** Debounce window for persisting the index to disk. */
  private static readonly INDEX_PERSIST_DEBOUNCE_MS = 500;

  constructor(baseDir: string = path.join(os.homedir(), '.zora')) {
    this._sessionsDir = path.join(baseDir, 'sessions');
    // Deliberately kept OUTSIDE the sessions directory so that a readdir() of
    // sessions/ still yields nothing but session transcripts.
    this._indexPath = path.join(baseDir, 'sessions-index.json');
    this._ensureDir();
  }

  /**
   * Appends an event to a session's history file.
   */
  async appendEvent(jobId: string, event: AgentEvent): Promise<void> {
    await this.appendEvents(jobId, [event]);
  }

  /**
   * Appends a batch of events as a single write. Used by BufferedSessionWriter.
   *
   * Spec §4.3: "Atomic writes for session history to prevent corruption"
   * For append-only, we use fs.promises.appendFile which is non-blocking.
   */
  async appendEvents(jobId: string, events: AgentEvent[]): Promise<void> {
    if (events.length === 0) return;

    const sessionPath = this.getSessionPath(jobId);
    const payload = events.map(e => JSON.stringify(e)).join('\n') + '\n';

    // Resolve the index entry BEFORE writing — we need to know whether the file
    // already existed to decide if the entry's byte accounting can be trusted.
    const entry = await this._entryForAppend(sessionPath);

    await fs.promises.appendFile(sessionPath, payload, 'utf8');

    if (entry) {
      entry.size += Buffer.byteLength(payload, 'utf8');
      entry.eventCount += events.length;
      const last = events[events.length - 1]!;
      const ts = new Date(last.timestamp);
      if (!Number.isNaN(ts.getTime())) {
        entry.lastActivity = ts.toISOString();
      }
      entry.status = statusForEventType(last.type);
      this._markDirty();
    }
  }

  /**
   * Reads all events for a given session.
   * Resilient to file corruption by skipping malformed lines.
   */
  async getHistory(jobId: string): Promise<AgentEvent[]> {
    const sessionPath = this.getSessionPath(jobId);
    if (!fs.existsSync(sessionPath)) return [];

    const content = await fs.promises.readFile(sessionPath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as AgentEvent;
        } catch (err: unknown) {
          // Skip corrupted lines
          return null;
        }
      })
      .filter((event): event is AgentEvent => event !== null);
  }

  /**
   * Deletes a session history file.
   */
  async deleteSession(jobId: string): Promise<void> {
    const sessionPath = this.getSessionPath(jobId);
    if (fs.existsSync(sessionPath)) {
      await fs.promises.unlink(sessionPath);
    }
    await this._ensureIndexLoaded();
    if (this._index.delete(path.basename(sessionPath, '.jsonl'))) {
      this._markDirty();
    }
  }

  /**
   * R16: Lists all sessions with metadata.
   *
   * PERF-02: reads the sessions directory and `stat()`s each `.jsonl` — one
   * syscall per file rather than a full read + parse. A session whose recorded
   * byte size still matches is served straight from the index; anything else
   * falls back to the original full-file scan and re-seeds the index entry.
   */
  async listSessions(): Promise<SessionSummary[]> {
    await this._ensureIndexLoaded();

    let files: string[];
    try {
      files = await fs.promises.readdir(this._sessionsDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      return [];
    }

    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    const sessions: SessionSummary[] = [];
    const seen = new Set<string>();
    let dirty = false;

    // stat() all files up front — cheap relative to reading them, and lets the
    // whole directory be validated against the index in one pass.
    const stats = await Promise.all(
      jsonlFiles.map(async (file): Promise<number | null> => {
        try {
          const st = await fs.promises.stat(path.join(this._sessionsDir, file));
          return st.size;
        } catch {
          return null;
        }
      }),
    );

    for (let i = 0; i < jsonlFiles.length; i++) {
      const file = jsonlFiles[i]!;
      const jobId = file.slice(0, -'.jsonl'.length);
      seen.add(jobId);

      const size = stats[i] ?? null;
      const cached = this._index.get(jobId);

      if (cached && size !== null && cached.size === size) {
        sessions.push({
          jobId,
          eventCount: cached.eventCount,
          lastActivity: cached.lastActivity ? new Date(cached.lastActivity) : null,
          status: cached.status,
        });
        continue;
      }

      // Cold path: index missing or stale for this session — full scan, then cache.
      const scanned = await this._scanSession(path.join(this._sessionsDir, file), size);
      sessions.push({
        jobId,
        eventCount: scanned.eventCount,
        lastActivity: scanned.lastActivity ? new Date(scanned.lastActivity) : null,
        status: scanned.status,
      });
      this._index.set(jobId, scanned);
      dirty = true;
    }

    // Drop index entries whose file is gone.
    for (const jobId of [...this._index.keys()]) {
      if (!seen.has(jobId)) {
        this._index.delete(jobId);
        dirty = true;
      }
    }

    if (dirty) this._markDirty();

    return sessions;
  }

  /** Returns the path for a session's JSONL file. Public for BufferedSessionWriter. */
  getSessionPath(jobId: string): string {
    // Sanitize jobId to prevent path traversal
    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this._sessionsDir, `${safeJobId}.jsonl`);
  }

  /**
   * Force the pending session index write to disk and cancel the debounce timer.
   * Called on shutdown; also useful in tests. Failure is non-fatal — the index
   * rebuilds itself on the next listSessions().
   */
  async flushIndex(): Promise<void> {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._persistPromise) await this._persistPromise;
    if (!this._indexDirty) return;
    await this._persistIndex();
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Returns the index entry to update after an append, or null when the file's
   * byte accounting cannot be trusted (pre-existing file with no index entry).
   * In the null case `listSessions()` performs one full scan and takes over.
   */
  private async _entryForAppend(sessionPath: string): Promise<SessionIndexEntry | null> {
    await this._ensureIndexLoaded();
    const key = path.basename(sessionPath, '.jsonl');

    const existing = this._index.get(key);
    if (existing) return existing;

    // No entry: only safe to start counting from zero if the file does not exist yet.
    try {
      await fs.promises.stat(sessionPath);
      return null; // File exists but is unindexed — let listSessions() scan it.
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }

    const fresh: SessionIndexEntry = { eventCount: 0, lastActivity: null, status: 'unknown', size: 0 };
    this._index.set(key, fresh);
    return fresh;
  }

  /**
   * Full-file scan — the original listSessions() logic, unchanged in behaviour:
   * blank lines ignored, malformed lines counted but not parsed, unreadable
   * files degrade to an 'unknown' entry rather than throwing.
   */
  private async _scanSession(filePath: string, size: number | null): Promise<SessionIndexEntry> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let lastActivity: string | null = null;
      let status = 'unknown';

      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        try {
          const lastEvent = JSON.parse(lastLine) as AgentEvent;
          const ts = new Date(lastEvent.timestamp);
          lastActivity = Number.isNaN(ts.getTime()) ? null : ts.toISOString();
          status = statusForEventType(lastEvent.type);
        } catch {
          // Malformed last line
        }
      }

      // Use the stat()'d size, not Buffer.byteLength(content) — decoding
      // invalid UTF-8 substitutes U+FFFD and would skew the byte count,
      // making the entry permanently stale.
      return {
        eventCount: lines.length,
        lastActivity,
        status,
        size: size ?? -1,
      };
    } catch {
      // Unreadable file — surface as an 'unknown' session, and use size -1 so
      // the entry never satisfies the staleness check and is re-scanned later.
      return { eventCount: 0, lastActivity: null, status: 'unknown', size: -1 };
    }
  }

  private async _ensureIndexLoaded(): Promise<void> {
    if (this._indexLoaded) return;
    if (!this._indexLoadPromise) {
      this._indexLoadPromise = (async () => {
        try {
          const raw = await fs.promises.readFile(this._indexPath, 'utf8');
          const parsed = JSON.parse(raw) as SessionIndexFile;
          if (parsed && parsed.version === 1 && parsed.sessions && typeof parsed.sessions === 'object') {
            for (const [jobId, entry] of Object.entries(parsed.sessions)) {
              if (
                entry &&
                typeof entry.eventCount === 'number' &&
                typeof entry.size === 'number' &&
                typeof entry.status === 'string'
              ) {
                this._index.set(jobId, {
                  eventCount: entry.eventCount,
                  lastActivity: typeof entry.lastActivity === 'string' ? entry.lastActivity : null,
                  status: entry.status,
                  size: entry.size,
                });
              }
            }
          }
        } catch {
          // Missing or corrupt index — start empty; listSessions() rebuilds it.
        } finally {
          this._indexLoaded = true;
        }
      })();
    }
    await this._indexLoadPromise;
  }

  private _markDirty(): void {
    this._indexDirty = true;
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistPromise = this._persistIndex().finally(() => {
        this._persistPromise = null;
      });
    }, SessionManager.INDEX_PERSIST_DEBOUNCE_MS);
    // Never hold the process open just to write a cache.
    this._persistTimer.unref?.();
  }

  private async _persistIndex(): Promise<void> {
    this._indexDirty = false;
    const snapshot: SessionIndexFile = { version: 1, sessions: {} };
    for (const [jobId, entry] of this._index) {
      snapshot.sessions[jobId] = entry;
    }
    try {
      await writeAtomic(this._indexPath, JSON.stringify(snapshot));
    } catch (err) {
      log.debug({ err }, 'Session index persist failed — will rebuild on next listSessions()');
    }
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this._sessionsDir)) {
      fs.mkdirSync(this._sessionsDir, { recursive: true });
    }
  }
}
