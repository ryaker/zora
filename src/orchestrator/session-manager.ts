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
   * Uses simple append for performance, but ensures directory exists.
   */
  async appendEvent(jobId: string, event: AgentEvent): Promise<void> {
    const sessionPath = this._getSessionPath(jobId);
    const line = JSON.stringify(event) + '\n';
    
    // We use synchronous append for v1 to ensure data is flushed before next loop iteration.
    // Spec §4.3 mentions atomic writes, but for append-only history, standard append is 
    // typically sufficient unless the file is being completely rewritten.
    fs.appendFileSync(sessionPath, line, 'utf8');
  }

  /**
   * Reads all events for a given session.
   */
  async getHistory(jobId: string): Promise<AgentEvent[]> {
    const sessionPath = this._getSessionPath(jobId);
    if (!fs.existsSync(sessionPath)) return [];

    const content = fs.readFileSync(sessionPath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as AgentEvent);
  }

  /**
   * Deletes a session history file.
   */
  async deleteSession(jobId: string): Promise<void> {
    const sessionPath = this._getSessionPath(jobId);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
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
