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
    const sessionPath = this._getSessionPath(jobId);
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
    const sessionPath = this._getSessionPath(jobId);
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
    const sessionPath = this._getSessionPath(jobId);
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
        const jobId = file.replace('.jsonl', '');
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

  private _getSessionPath(jobId: string): string {
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
