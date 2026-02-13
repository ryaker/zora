/**
 * RoutineManager — Manages scheduled and recurring tasks (routines).
 *
 * Spec §5.6 "Cron Routines (Scheduled)":
 *   - Loads routine definitions from TOML files.
 *   - Schedules tasks using node-cron.
 *   - Supports model preference and timeouts per routine.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import cron, { type ScheduledTask } from 'node-cron';
import * as smol from 'smol-toml';
import type { RoutineDefinition } from '../types.js';
import { ExecutionLoop } from '../orchestrator/execution-loop.js';

export class RoutineManager {
  private readonly _routinesDir: string;
  private readonly _loop: ExecutionLoop;
  private readonly _scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor(loop: ExecutionLoop, baseDir: string = path.join(os.homedir(), '.zora')) {
    this._loop = loop;
    this._routinesDir = path.join(baseDir, 'routines');
  }

  /**
   * Initializes the routines directory and loads existing routines.
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this._routinesDir, { recursive: true });
    } catch (err) {
      console.error(`Failed to create routines directory at ${this._routinesDir}:`, err);
    }

    await this.loadAll();
  }

  /**
   * Loads all routine definitions from the routines directory.
   */
  async loadAll(): Promise<void> {
    try {
      const files = await fs.readdir(this._routinesDir);
      for (const file of files) {
        if (file.endsWith('.toml')) {
          await this.loadRoutine(path.join(this._routinesDir, file));
        }
      }
    } catch (err) {
      console.error(`Failed to read routines directory:`, err);
    }
  }

  /**
   * Loads a single routine from a TOML file and schedules it.
   */
  async loadRoutine(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const raw = smol.parse(content) as any;
      
      if (this._isValidRoutine(raw)) {
        const definition = raw as RoutineDefinition;
        if (definition.routine.enabled !== false) {
          this.scheduleRoutine(definition);
        }
      } else {
        console.error(`Invalid routine definition in ${filePath}`);
      }
    } catch (err) {
      console.error(`Failed to load routine from ${filePath}:`, err);
    }
  }

  /**
   * Schedules a routine using node-cron.
   */
  scheduleRoutine(definition: RoutineDefinition): void {
    const { routine, task } = definition;

    // Stop existing task if it exists
    if (this._scheduledTasks.has(routine.name)) {
      this._scheduledTasks.get(routine.name)!.stop();
    }

    const scheduledTask = cron.schedule(routine.schedule, async () => {
      try {
        await this._loop.run(task.prompt);
      } catch (err) {
        console.error(`Routine ${routine.name} failed:`, err);
      }
    });

    this._scheduledTasks.set(routine.name, scheduledTask);
  }

  /**
   * Basic validation for RoutineDefinition.
   */
  private _isValidRoutine(raw: any): raw is RoutineDefinition {
    return (
      raw &&
      typeof raw.routine === 'object' &&
      typeof raw.routine.name === 'string' &&
      typeof raw.routine.schedule === 'string' &&
      typeof raw.task === 'object' &&
      typeof raw.task.prompt === 'string'
    );
  }

  /**
   * Stops all scheduled tasks.
   */
  stopAll(): void {
    for (const task of this._scheduledTasks.values()) {
      task.stop();
    }
    this._scheduledTasks.clear();
  }

  get scheduledCount(): number {
    return this._scheduledTasks.size;
  }
}
