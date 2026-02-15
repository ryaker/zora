/**
 * RetryQueue — Persistence and scheduling for failed tasks.
 *
 * Spec §4.2 "Scheduler":
 *   - Tasks failed due to quota/transient errors are scheduled for retry.
 *   - Uses exponential backoff for cooldown tracking.
 *   - Persists state to prevent loss across restarts.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { writeAtomic } from '../utils/fs.js';
import { isENOENT } from '../utils/errors.js';
import type { TaskContext } from '../types.js';

export interface RetryEntry {
  task: TaskContext;
  retryCount: number;
  lastError: string;
  nextRunAt: Date;
}

export class RetryQueue {
  private readonly _stateFile: string;
  private _queue: RetryEntry[] = [];

  constructor(baseDir: string = path.join(os.homedir(), '.zora')) {
    this._stateFile = path.join(baseDir, 'state', 'retry-queue.json');
  }

  /**
   * Initializes the queue by loading persisted state.
   */
  async init(): Promise<void> {
    try {
      const dir = path.dirname(this._stateFile);
      // Spec §4.3: Secure directory creation with restrictive permissions (0o700)
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      
      const content = await fs.readFile(this._stateFile, 'utf8');
      const raw = JSON.parse(content) as Array<Record<string, unknown>>;
      this._queue = raw.map(entry => ({
        task: entry['task'] as TaskContext,
        retryCount: entry['retryCount'] as number,
        lastError: entry['lastError'] as string,
        nextRunAt: new Date(entry['nextRunAt'] as string),
      }));
    } catch (err: unknown) {
      if (isENOENT(err)) {
        // File doesn't exist, which is fine on first run.
        this._queue = [];
      } else {
        // For corruption or other errors, log it and start fresh.
        console.warn(`[RetryQueue] Failed to load state from ${this._stateFile}, starting fresh. Error:`, err);
        this._queue = [];
      }
    }
  }

  /**
   * Adds a task to the retry queue with exponential backoff.
   */
  async enqueue(task: TaskContext, error: string, maxRetries: number = 3): Promise<void> {
    const existingIndex = this._queue.findIndex(e => e.task.jobId === task.jobId);
    let retryCount = 1;
    
    if (existingIndex !== -1) {
      retryCount = this._queue[existingIndex]!.retryCount + 1;
      if (retryCount > maxRetries) {
        this._queue.splice(existingIndex, 1);
        await this._save();
        throw new Error(`Max retries exceeded for task ${task.jobId}`);
      }
    }

    // Quadratic backoff: 1m, 4m, 9m... (retryCount^2 minutes)
    const delayMs = Math.pow(retryCount, 2) * 60 * 1000;
    const nextRunAt = new Date(Date.now() + delayMs);

    const entry: RetryEntry = {
      task,
      retryCount,
      lastError: error,
      nextRunAt
    };

    if (existingIndex !== -1) {
      this._queue[existingIndex] = entry;
    } else {
      this._queue.push(entry);
    }

    await this._save();
  }

  /**
   * Returns tasks that are ready to be retried.
   */
  getReadyTasks(): TaskContext[] {
    const now = Date.now();
    const ready = this._queue.filter(e => e.nextRunAt.getTime() <= now);
    return ready.map(e => e.task);
  }

  /**
   * Removes a task from the queue once successfully completed.
   */
  async remove(jobId: string): Promise<void> {
    this._queue = this._queue.filter(e => e.task.jobId !== jobId);
    await this._save();
  }

  private async _save(): Promise<void> {
    await writeAtomic(this._stateFile, JSON.stringify(this._queue, null, 2));
  }

  get size(): number {
    return this._queue.length;
  }
}
