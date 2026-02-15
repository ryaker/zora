/**
 * HeartbeatSystem — Periodic proactive task checks.
 *
 * Spec §5.6 "Heartbeat (Proactive)":
 *   - Checks HEARTBEAT.md periodically.
 *   - Parses unchecked markdown tasks.
 *   - Validates tasks through PolicyEngine before execution.
 *   - Enforces a per-cycle task budget to limit runaway execution.
 *   - Executes approved tasks through the execution loop.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import cron, { type ScheduledTask } from 'node-cron';
import { ExecutionLoop } from '../orchestrator/execution-loop.js';
import type { PolicyEngine } from '../security/policy-engine.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('heartbeat');

/** Maximum number of heartbeat tasks executed in a single pulse cycle. */
const MAX_HEARTBEAT_TASKS_PER_CYCLE = 3;

export interface HeartbeatOptions {
  loop: ExecutionLoop;
  policyEngine?: PolicyEngine;
  baseDir?: string;
  intervalMinutes?: number;
  maxTasksPerCycle?: number;
}

export class HeartbeatSystem {
  private readonly _loop: ExecutionLoop;
  private readonly _policyEngine?: PolicyEngine;
  private readonly _heartbeatFile: string;
  private readonly _intervalMinutes: number;
  private readonly _maxTasksPerCycle: number;
  private _scheduledTask: ScheduledTask | null = null;

  constructor(options: HeartbeatOptions) {
    this._loop = options.loop;
    this._policyEngine = options.policyEngine;
    const baseDir = options.baseDir ?? path.join(os.homedir(), '.zora');
    this._heartbeatFile = path.join(baseDir, 'workspace', 'HEARTBEAT.md');
    this._intervalMinutes = options.intervalMinutes ?? 30;
    this._maxTasksPerCycle = options.maxTasksPerCycle ?? MAX_HEARTBEAT_TASKS_PER_CYCLE;
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
   * Performs a single pulse: reads HEARTBEAT.md, validates tasks through
   * the policy engine, and runs approved tasks up to the per-cycle budget.
   */
  async pulse(): Promise<void> {
    try {
      const content = await fs.readFile(this._heartbeatFile, 'utf8');
      const lines = content.split('\n');
      const updatedLines = [...lines];
      let tasksRun = 0;
      let tasksSkippedBudget = 0;
      let tasksSkippedPolicy = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Match unchecked task: - [ ] Task description
        const match = line.match(/^-\s*\[\s*\]\s*(.+)$/);

        if (match) {
          const taskText = match[1]!.trim();

          // Budget enforcement: limit tasks per cycle
          if (tasksRun >= this._maxTasksPerCycle) {
            tasksSkippedBudget++;
            log.warn(
              { task: taskText, maxPerCycle: this._maxTasksPerCycle },
              'Heartbeat task skipped: per-cycle budget reached',
            );
            continue;
          }

          // Policy validation: check budget status via PolicyEngine
          if (this._policyEngine) {
            const budgetStatus = this._policyEngine.getBudgetStatus();
            if (budgetStatus.exceeded) {
              tasksSkippedPolicy++;
              log.warn(
                { task: taskText, exceededCategories: budgetStatus.exceededCategories },
                'Heartbeat task skipped: policy budget exceeded',
              );
              continue;
            }

            const actionResult = this._policyEngine.recordAction('heartbeat_task');
            if (!actionResult.allowed) {
              tasksSkippedPolicy++;
              log.warn(
                { task: taskText, reason: actionResult.reason },
                'Heartbeat task skipped: policy action denied',
              );
              continue;
            }
          }

          try {
            await this._loop.run(taskText);
            // Mark as done: - [x] Task description
            updatedLines[i] = line.replace(/^-\s*\[\s*\]/, '- [x]');
            tasksRun++;
          } catch (err) {
            log.error({ task: taskText, err }, 'Heartbeat task failed');
          }
        }
      }

      if (tasksSkippedBudget > 0 || tasksSkippedPolicy > 0) {
        log.info(
          { tasksRun, tasksSkippedBudget, tasksSkippedPolicy },
          'Heartbeat pulse completed with skipped tasks',
        );
      }

      if (tasksRun > 0) {
        await fs.writeFile(this._heartbeatFile, updatedLines.join('\n'), 'utf8');
      }
    } catch (err) {
      log.error({ err }, 'Failed to perform heartbeat pulse');
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
      log.error({ heartbeatFile: this._heartbeatFile, err }, 'Failed to ensure heartbeat file');
    }
  }
}
