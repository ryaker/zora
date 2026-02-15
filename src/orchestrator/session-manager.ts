/**
 * SessionManager — Persistence for agent work sessions using JSONL.
 *
 * Spec §4.3 "Filesystem Layout":
 *   - sessions/{job-id}.jsonl: Per-job conversation history
 *   - Atomic writes for session history to prevent corruption
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session-manager');

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
        const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
        await fs.promises.appendFile(
          this._sessionManager.getSessionPath(this._jobId),
          lines,
          'utf8',
        );
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

  constructor(baseDir: string = path.join(os.homedir(), '.zora')) {
    this._sessionsDir = path.join(baseDir, 'sessions');
    this._ensureDir();
  }

  /**
   * Appends an event to a session's history file.
   */
  async appendEvent(jobId: string, event: AgentEvent): Promise<void> {
    const sessionPath = this.getSessionPath(jobId);
    const line = JSON.stringify(event) + '\n';
    
    // Spec §4.3: "Atomic writes for session history to prevent corruption"
    // For append-only, we use fs.promises.appendFile which is non-blocking.
    await fs.promises.appendFile(sessionPath, line, 'utf8');
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
  }

  /**
   * R16: Lists all sessions with metadata.
   * Reads the sessions directory, parses each .jsonl file for event count,
   * reads last line for timestamp/status.
   */
  async listSessions(): Promise<Array<{ jobId: string; eventCount: number; lastActivity: Date | null; status: string }>> {
    const sessions: Array<{ jobId: string; eventCount: number; lastActivity: Date | null; status: string }> = [];

    try {
      const files = await fs.promises.readdir(this._sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const jobId = file.replace(/\.jsonl$/, '');
        const filePath = path.join(this._sessionsDir, file);

        try {
          const content = await fs.promises.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          const eventCount = lines.length;
          let lastActivity: Date | null = null;
          let status = 'unknown';

          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1]!;
            try {
              const lastEvent = JSON.parse(lastLine) as AgentEvent;
              lastActivity = new Date(lastEvent.timestamp);
              status = lastEvent.type === 'done' ? 'completed'
                : lastEvent.type === 'error' ? 'failed'
                : 'running';
            } catch {
              // Malformed last line
            }
          }

          sessions.push({ jobId, eventCount, lastActivity, status });
        } catch {
          sessions.push({ jobId, eventCount: 0, lastActivity: null, status: 'unknown' });
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    return sessions;
  }

  /** Returns the path for a session's JSONL file. Public for BufferedSessionWriter. */
  getSessionPath(jobId: string): string {
    // Sanitize jobId to prevent path traversal
    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this._sessionsDir, `${safeJobId}.jsonl`);
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this._sessionsDir)) {
      fs.mkdirSync(this._sessionsDir, { recursive: true });
    }
  }
}
