/**
 * GeminiBridge — Bridges Gemini agent communication via CLI subprocess.
 *
 * Spec v0.6 §5.7 "Gemini Bridge":
 *   - Polls the gemini-agent inbox for unread task messages.
 *   - Spawns the Gemini CLI to process tasks.
 *   - Posts results back to the coordinator's inbox.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Mailbox } from './mailbox.js';

export interface GeminiBridgeOptions {
  pollIntervalMs: number;
  geminiCliPath: string;
  onPollComplete?: () => void | Promise<void>;
}

export class GeminiBridge {
  private readonly _teamName: string;
  private readonly _mailbox: Mailbox;
  private readonly _pollIntervalMs: number;
  private readonly _geminiCliPath: string;
  private _onPollComplete?: () => void | Promise<void>;
  private _running = false;
  private _polling = false;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _activeProcess: ChildProcess | null = null;

  constructor(
    teamName: string,
    mailbox: Mailbox,
    options: GeminiBridgeOptions,
  ) {
    this._teamName = teamName;
    this._mailbox = mailbox;
    this._pollIntervalMs = options.pollIntervalMs;
    this._geminiCliPath = options.geminiCliPath;
    this._onPollComplete = options.onPollComplete;
  }

  /**
   * Starts polling the inbox for task messages.
   */
  start(): void {
    if (this._running) return;
    this._running = true;

    this._pollTimer = setInterval(() => {
      void this._poll();
    }, this._pollIntervalMs);
  }

  /**
   * Stops polling and kills any active subprocess.
   */
  stop(): void {
    this._running = false;

    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    if (this._activeProcess) {
      this._activeProcess.kill();
      this._activeProcess = null;
    }
  }

  isRunning(): boolean {
    return this._running;
  }

  /**
   * Sets the callback invoked after each successful poll cycle.
   * Used by BridgeWatchdog to update the heartbeat.
   */
  setOnPollComplete(callback: () => void | Promise<void>): void {
    this._onPollComplete = callback;
  }

  private async _poll(): Promise<void> {
    if (!this._running || this._polling) return;
    this._polling = true;

    try {
      const messages = await this._mailbox.receive(this._teamName);
      const tasks = messages.filter((m) => m.type === 'task');

      for (const task of tasks) {
        if (!this._running) break;
        await this._executeTask(task.text, task.from);
      }

      // Signal successful poll completion (used by watchdog for heartbeat)
      if (this._onPollComplete) {
        await this._onPollComplete();
      }
    } catch (err) {
      console.error('[GeminiBridge] Poll error:', err);
    } finally {
      this._polling = false;
    }
  }

  private async _executeTask(taskText: string, fromAgent: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const child = spawn(this._geminiCliPath, ['chat', '--prompt', taskText], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this._activeProcess = child;

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        this._activeProcess = null;

        const resultText = code === 0
          ? stdout.trim() || '(no output)'
          : `Error (exit ${code ?? 'unknown'}): ${stderr.trim() || stdout.trim()}`;

        // Post result back to the requesting agent
        this._mailbox
          .send(this._teamName, fromAgent, {
            type: 'result',
            text: resultText,
          })
          .then(() => resolve())
          .catch((err) => {
            console.error('[GeminiBridge] Failed to send result:', err);
            resolve();
          });
      });

      child.on('error', (err) => {
        this._activeProcess = null;
        console.error('[GeminiBridge] Process error:', err);

        // Send error result back to requesting agent
        this._mailbox
          .send(this._teamName, fromAgent, {
            type: 'result',
            text: `Error (spawn failure): ${err.message}`,
          })
          .then(() => resolve())
          .catch((sendErr) => {
            console.error('[GeminiBridge] Failed to send error result:', sendErr);
            resolve();
          });
      });
    });
  }
}
