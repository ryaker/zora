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
