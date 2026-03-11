/**
 * ChannelAuditLog — Append-only JSONL logger for all channel intake decisions.
 *
 * Logs:
 *   - Intake decisions (allow/deny)
 *   - Quarantine flags (suspicious patterns)
 *   - Tool calls / action budget events
 *
 * Rotation: rotates at 10MB.
 * Location: ~/.zora/audit/channel.log
 *
 * INVARIANT-6: Never log raw message content.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('channel-audit');

export interface AuditEntry {
  timestamp: string;
  adapter: string;
  sender: string;
  channelId: string;
  action: 'intake_allowed' | 'intake_denied' | 'quarantine_flag' | 'tool_call' | 'budget_exhausted';
  status: 'ok' | 'blocked' | 'error';
  metadata?: Record<string, unknown>;
}

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

export class ChannelAuditLog {
  private readonly _logPath: string;

  constructor(baseDir?: string) {
    const root = baseDir ?? path.join(os.homedir(), '.zora');
    this._logPath = path.join(root, 'audit', 'channel.log');

    // Ensure directory exists
    const dir = path.dirname(this._logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Append an entry to the JSONL log.
   */
  async append(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      // Rotation check before append
      await this._checkRotation();

      const line = JSON.stringify(fullEntry) + '\n';
      await fs.promises.appendFile(this._logPath, line, 'utf-8');
    } catch (err) {
      log.error({ err, action: entry.action }, 'Failed to write to channel audit log');
    }
  }

  /** Internal: Rotate log file if it exceeds MAX_LOG_SIZE */
  private async _checkRotation(): Promise<void> {
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(this._logPath);
    } catch {
      // File doesn't exist yet — nothing to rotate
      return;
    }

    try {
      if (stats.size > MAX_LOG_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = `${this._logPath}.${timestamp}.bak`;
        await fs.promises.rename(this._logPath, rotatedPath);
        log.info({ rotatedTo: rotatedPath }, 'Channel audit log rotated');
      }
    } catch (err) {
      log.warn({ err }, 'Log rotation check failed');
    }
  }
}
