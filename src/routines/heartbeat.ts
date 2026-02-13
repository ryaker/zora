/**
 * HeartbeatSystem — Periodic proactive task checks.
 *
 * Spec §5.6 "Heartbeat (Proactive)":
 *   - Checks HEARTBEAT.md periodically.
 *   - Parses unchecked markdown tasks.
 *   - Executes tasks through the execution loop.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import cron, { type ScheduledTask } from 'node-cron';
import { ExecutionLoop } from '../orchestrator/execution-loop.js';

export interface HeartbeatOptions {
  loop: ExecutionLoop;
  baseDir?: string;
  intervalMinutes?: number;
}

export class HeartbeatSystem {
  private readonly _loop: ExecutionLoop;
  private readonly _heartbeatFile: string;
  private readonly _intervalMinutes: number;
  private _scheduledTask: ScheduledTask | null = null;

  constructor(options: HeartbeatOptions) {
    this._loop = options.loop;
    const baseDir = options.baseDir ?? path.join(os.homedir(), '.zora');
    this._heartbeatFile = path.join(baseDir, 'workspace', 'HEARTBEAT.md');
    this._intervalMinutes = options.intervalMinutes ?? 30;
  }

  /**
   * Starts the heartbeat system.
   */
  async start(): Promise<void> {
    await this._ensureFile();

    const schedule = `*/${this._intervalMinutes} * * * *`;
    this._scheduledTask = cron.schedule(schedule, async () => {
      await this.pulse();
    });
  }

  /**
   * Performs a single pulse: reads HEARTBEAT.md and runs pending tasks.
   */
  async pulse(): Promise<void> {
    try {
      const content = await fs.readFile(this._heartbeatFile, 'utf8');
      const lines = content.split('\n');
      const updatedLines = [...lines];
      let tasksRun = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Match unchecked task: - [ ] Task description
        const match = line.match(/^-\s*\[\s*\]\s*(.+)$/);
        
        if (match) {
          const taskText = match[1]!.trim();
          try {
            await this._loop.run(taskText);
            // Mark as done: - [x] Task description
            updatedLines[i] = line.replace(/^-\s*\[\s*\]/, '- [x]');
            tasksRun++;
          } catch (err) {
            console.error(`Heartbeat task failed: ${taskText}`, err);
          }
        }
      }

      if (tasksRun > 0) {
        await fs.writeFile(this._heartbeatFile, updatedLines.join('\n'), 'utf8');
      }
    } catch (err) {
      console.error(`Failed to perform heartbeat pulse:`, err);
    }
  }

  /**
   * Stops the heartbeat system.
   */
  stop(): void {
    if (this._scheduledTask) {
      this._scheduledTask.stop();
      this._scheduledTask = null;
    }
  }

  private async _ensureFile(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this._heartbeatFile), { recursive: true });
      try {
        await fs.access(this._heartbeatFile);
      } catch {
        const defaultContent = '# Zora Heartbeat Tasks\n\n- [ ] Summarize today\'s work\n';
        await fs.writeFile(this._heartbeatFile, defaultContent, 'utf8');
      }
    } catch (err) {
      console.error(`Failed to ensure heartbeat file at ${this._heartbeatFile}:`, err);
    }
  }
}
