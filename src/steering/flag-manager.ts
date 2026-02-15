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
import { getLogger } from '../utils/logger.js';

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

export interface FlagFileDiagnostic {
  file: string;
  status: 'loaded' | 'failed';
  errorType?: 'not_found' | 'permission' | 'parse_error' | 'read_error';
  reason?: string;
  timestamp: number;
}

export interface FlagConfigStatus {
  filesLoaded: number;
  filesFailed: number;
  failedFiles: FlagFileDiagnostic[];
  timestamp: number;
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
  private readonly _diagnostics: FlagFileDiagnostic[] = [];
  private _filesLoaded = 0;
  private _filesFailed = 0;

  constructor(flagsDir: string, options: FlagManagerOptions) {
    this._flagsDir = flagsDir;
    this._timeoutMs = options.timeoutMs;
    this._notifyFn = options.notifyFn;
  }

  /**
   * Returns diagnostic status of flag file loading operations.
   */
  getConfigStatus(): FlagConfigStatus {
    return {
      filesLoaded: this._filesLoaded,
      filesFailed: this._filesFailed,
      failedFiles: this._diagnostics.filter(d => d.status === 'failed'),
      timestamp: Date.now(),
    };
  }

  /**
   * Creates a new flag for a decision. Starts the timeout clock.
   */
  async flag(
    jobId: string,
    question: string,
    defaultAction: string,
  ): Promise<string> {
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

    // Start timeout timer
    const timer = setTimeout(() => {
      void this._autoResolve(flagId, defaultAction);
    }, this._timeoutMs);
    this._timers.set(flagId, timer);

    return flagId;
  }

  /**
   * Lists all flags, optionally filtered by job ID.
   */
  async getFlags(jobId?: string): Promise<FlagEntry[]> {
    const logger = getLogger();
    try {
      const files = await fs.readdir(this._flagsDir);
      const flags: FlagEntry[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this._flagsDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const entry = JSON.parse(content) as FlagEntry;
          if (!jobId || entry.jobId === jobId) {
            flags.push(entry);
          }
          this._filesLoaded++;
          this._diagnostics.push({ file, status: 'loaded', timestamp: Date.now() });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const code = (err as NodeJS.ErrnoException).code;
          const errorType = err instanceof SyntaxError
            ? 'parse_error' as const
            : code === 'ENOENT'
              ? 'not_found' as const
              : code === 'EACCES'
                ? 'permission' as const
                : 'read_error' as const;

          logger.warn(`FlagManager: Failed to load flag file`, {
            path: filePath,
            errorType,
            error: errMsg,
          });

          this._filesFailed++;
          this._diagnostics.push({
            file,
            status: 'failed',
            errorType,
            reason: errMsg,
            timestamp: Date.now(),
          });
        }
      }

      return flags;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errorType = code === 'ENOENT'
          ? 'not_found' as const
          : code === 'EACCES'
            ? 'permission' as const
            : 'read_error' as const;

        logger.warn(`FlagManager: Failed to read flags directory`, {
          path: this._flagsDir,
          errorType,
          error: errMsg,
        });

        this._filesFailed++;
        this._diagnostics.push({
          file: this._flagsDir,
          status: 'failed',
          errorType,
          reason: errMsg,
          timestamp: Date.now(),
        });
      }
      return [];
    }
  }

  /**
   * Approves a flag.
   */
  async approve(flagId: string): Promise<void> {
    await this._resolve(flagId, 'approved');
  }

  /**
   * Rejects a flag with a reason.
   */
  async reject(flagId: string, reason: string): Promise<void> {
    await this._resolve(flagId, 'rejected', reason);
  }

  /**
   * Returns the current decision status for a flag.
   */
  async getFlagDecision(flagId: string): Promise<'pending' | 'approved' | 'rejected'> {
    const logger = getLogger();
    const flagPath = path.join(this._flagsDir, `${flagId}.json`);
    try {
      const content = await fs.readFile(flagPath, 'utf8');
      const entry = JSON.parse(content) as FlagEntry;
      if (entry.status === 'pending_review') return 'pending';
      if (entry.status === 'approved' || entry.status === 'timed_out') return 'approved';
      return 'rejected';
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const code = (err as NodeJS.ErrnoException).code;
      const errorType = err instanceof SyntaxError
        ? 'parse_error' as const
        : code === 'ENOENT'
          ? 'not_found' as const
          : 'read_error' as const;

      logger.warn(`FlagManager: Failed to read flag decision`, {
        flagId,
        path: flagPath,
        errorType,
        error: errMsg,
      });

      this._diagnostics.push({
        file: `${flagId}.json`,
        status: 'failed',
        errorType,
        reason: errMsg,
        timestamp: Date.now(),
      });

      return 'pending';
    }
  }

  private async _resolve(
    flagId: string,
    status: 'approved' | 'rejected',
    reason?: string,
  ): Promise<void> {
    // Cancel timeout timer
    const timer = this._timers.get(flagId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(flagId);
    }

    const logger = getLogger();
    const flagPath = path.join(this._flagsDir, `${flagId}.json`);
    let content: string;
    try {
      content = await fs.readFile(flagPath, 'utf8');
    } catch {
      throw new Error(`Flag not found: ${flagId}`);
    }
    let entry: FlagEntry;
    try {
      entry = JSON.parse(content) as FlagEntry;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`FlagManager: Corrupted flag file during resolve`, {
        flagId,
        path: flagPath,
        errorType: 'parse_error',
        error: errMsg,
      });
      throw new Error(`Corrupted flag file: ${flagId}`);
    }

    // Only resolve if still pending to avoid TOCTOU race
    if (entry.status !== 'pending_review') {
      return; // Already resolved
    }

    entry.status = status;
    entry.resolvedAt = new Date().toISOString();
    if (reason) {
      entry.chosenAction = reason;
    }

    await writeAtomic(flagPath, JSON.stringify(entry, null, 2));
  }

  private async _autoResolve(flagId: string, defaultAction: string): Promise<void> {
    const logger = getLogger();
    this._timers.delete(flagId);

    const flagPath = path.join(this._flagsDir, `${flagId}.json`);
    try {
      const content = await fs.readFile(flagPath, 'utf8');
      const entry = JSON.parse(content) as FlagEntry;

      // Only auto-resolve if still pending
      if (entry.status !== 'pending_review') return;

      entry.status = 'timed_out';
      entry.chosenAction = defaultAction;
      entry.resolvedAt = new Date().toISOString();

      await writeAtomic(flagPath, JSON.stringify(entry, null, 2));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errorType = err instanceof SyntaxError ? 'parse_error' as const : 'read_error' as const;

      logger.warn(`FlagManager: Failed to auto-resolve flag`, {
        flagId,
        path: flagPath,
        errorType,
        error: errMsg,
      });

      this._diagnostics.push({
        file: `${flagId}.json`,
        status: 'failed',
        errorType,
        reason: errMsg,
        timestamp: Date.now(),
      });
    }
  }
}
