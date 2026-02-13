/**
 * FlagManager — Allows agents to flag decisions without blocking execution.
 *
 * Spec v0.6 §5.8 "Flagging Without Blocking":
 *   - Agents create flags for decisions they're unsure about.
 *   - Flags auto-resolve with the default action after a timeout.
 *   - Humans can approve or reject flags before the timeout.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from '../utils/fs.js';

export interface FlagEntry {
  flagId: string;
  jobId: string;
  question: string;
  defaultAction: string;
  chosenAction: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'timed_out';
  timestamp: string;
  resolvedAt?: string;
}

export interface FlagManagerOptions {
  timeoutMs: number;
  notifyFn?: (msg: string) => void;
}

export class FlagManager {
  private readonly _flagsDir: string;
  private readonly _timeoutMs: number;
  private readonly _notifyFn?: (msg: string) => void;
  private readonly _timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(flagsDir: string, options: FlagManagerOptions) {
    this._flagsDir = flagsDir;
    this._timeoutMs = options.timeoutMs;
    this._notifyFn = options.notifyFn;
  }

  async flag(jobId: string, question: string, defaultAction: string): Promise<string> {
    await fs.mkdir(this._flagsDir, { recursive: true });

    const flagId = `flag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const entry: FlagEntry = {
      flagId,
      jobId,
      question,
      defaultAction,
      chosenAction: defaultAction,
      status: 'pending_review',
      timestamp: new Date().toISOString(),
    };

    const flagPath = path.join(this._flagsDir, `${flagId}.json`);
    await writeAtomic(flagPath, JSON.stringify(entry, null, 2));

    if (this._notifyFn) {
      this._notifyFn(`Flag created for job ${jobId}: ${question} (default: ${defaultAction})`);
    }

    const timer = setTimeout(() => {
      void this._autoResolve(flagId, defaultAction);
    }, this._timeoutMs);
    this._timers.set(flagId, timer);

    return flagId;
  }

  async getFlags(jobId?: string): Promise<FlagEntry[]> {
    try {
      const files = await fs.readdir(this._flagsDir);
      const flags: FlagEntry[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await fs.readFile(path.join(this._flagsDir, file), 'utf8');
          const entry = JSON.parse(content) as FlagEntry;
          if (!jobId || entry.jobId === jobId) {
            flags.push(entry);
          }
        } catch {
          // Skip malformed files
        }
      }
      return flags;
    } catch {
      return [];
    }
  }

  async approve(flagId: string): Promise<void> {
    await this._resolve(flagId, 'approved');
  }

  async reject(flagId: string, reason: string): Promise<void> {
    await this._resolve(flagId, 'rejected', reason);
  }

  async getFlagDecision(flagId: string): Promise<'pending' | 'approved' | 'rejected'> {
    const flagPath = path.join(this._flagsDir, `${flagId}.json`);
    try {
      const content = await fs.readFile(flagPath, 'utf8');
      const entry = JSON.parse(content) as FlagEntry;
      if (entry.status === 'pending_review') return 'pending';
      if (entry.status === 'approved' || entry.status === 'timed_out') return 'approved';
      return 'rejected';
    } catch {
      return 'pending';
    }
  }

  private async _resolve(
    flagId: string,
    status: 'approved' | 'rejected',
    reason?: string,
  ): Promise<void> {
    const timer = this._timers.get(flagId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(flagId);
    }

    const flagPath = path.join(this._flagsDir, `${flagId}.json`);
    const content = await fs.readFile(flagPath, 'utf8');
    const entry = JSON.parse(content) as FlagEntry;

    entry.status = status;
    entry.resolvedAt = new Date().toISOString();
    if (reason) {
      entry.chosenAction = reason;
    }

    await writeAtomic(flagPath, JSON.stringify(entry, null, 2));
  }

  private async _autoResolve(flagId: string, defaultAction: string): Promise<void> {
    this._timers.delete(flagId);
    const flagPath = path.join(this._flagsDir, `${flagId}.json`);
    try {
      const content = await fs.readFile(flagPath, 'utf8');
      const entry = JSON.parse(content) as FlagEntry;
      if (entry.status !== 'pending_review') return;
      entry.status = 'timed_out';
      entry.chosenAction = defaultAction;
      entry.resolvedAt = new Date().toISOString();
      await writeAtomic(flagPath, JSON.stringify(entry, null, 2));
    } catch {
      // Flag may have been deleted
    }
  }
}
