/**
 * RoutineManager — Manages scheduled and recurring tasks (routines).
 *
 * Spec §5.6 "Cron Routines (Scheduled)":
 *   - Loads routine definitions from TOML files.
 *   - Schedules tasks using node-cron.
 *   - Supports model preference, cost ceiling, and timeouts per routine.
 *
 * Routines are executed through a RoutineTaskSubmitter function, which
 * routes them through the Orchestrator's full pipeline (Router, failover,
 * memory context, session persistence) rather than calling ExecutionLoop
 * directly. This ensures model_preference and max_cost_tier flow through
 * to the routing layer.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import cron, { type ScheduledTask } from 'node-cron';
import * as smol from 'smol-toml';
import type { RoutineDefinition, CostTier } from '../types.js';

/**
 * Function signature for submitting routine tasks through the orchestration pipeline.
 * Injected by the Orchestrator at construction time.
 */
export type RoutineTaskSubmitter = (options: {
  prompt: string;
  model?: string;
  maxCostTier?: CostTier;
}) => Promise<string>;

export class RoutineManager {
  private readonly _routinesDir: string;
  private readonly _submitTask: RoutineTaskSubmitter;
  private readonly _scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor(submitTask: RoutineTaskSubmitter, baseDir: string = path.join(os.homedir(), '.zora')) {
    this._submitTask = submitTask;
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
      const raw: unknown = smol.parse(content);

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
   * Passes model_preference and max_cost_tier through the task submitter
   * so the Router can select the appropriate provider.
   */
  scheduleRoutine(definition: RoutineDefinition): void {
    const { routine, task } = definition;

    // Stop existing task if it exists
    if (this._scheduledTasks.has(routine.name)) {
      this._scheduledTasks.get(routine.name)!.stop();
    }

    const scheduledTask = cron.schedule(routine.schedule, async () => {
      try {
        await this._submitTask({
          prompt: task.prompt,
          model: routine.model_preference,
          maxCostTier: routine.max_cost_tier,
        });
      } catch (err) {
        console.error(`Routine ${routine.name} failed:`, err);
      }
    });

    this._scheduledTasks.set(routine.name, scheduledTask);
  }

  /**
   * Directly runs a routine's task through the submitter (for testing and manual triggers).
   */
  async runRoutine(definition: RoutineDefinition): Promise<string> {
    const { routine, task } = definition;
    return this._submitTask({
      prompt: task.prompt,
      model: routine.model_preference,
      maxCostTier: routine.max_cost_tier,
    });
  }

  /**
   * Basic validation for RoutineDefinition.
   */
  private _isValidRoutine(raw: unknown): raw is RoutineDefinition {
    if (!raw || typeof raw !== 'object') return false;
    const obj = raw as Record<string, unknown>;
    const routine = obj['routine'];
    const task = obj['task'];
    if (
      !routine || typeof routine !== 'object' ||
      !task || typeof task !== 'object'
    ) {
      return false;
    }
    const r = routine as Record<string, unknown>;
    const t = task as Record<string, unknown>;
    if (typeof r['name'] !== 'string' || typeof r['schedule'] !== 'string' || typeof t['prompt'] !== 'string') {
      return false;
    }

    // Validate optional max_cost_tier if present
    if (r['max_cost_tier'] !== undefined) {
      const validTiers = ['free', 'included', 'metered', 'premium'];
      if (!validTiers.includes(r['max_cost_tier'] as string)) {
        console.warn(
          `Invalid max_cost_tier "${r['max_cost_tier']}" in routine "${r['name']}". ` +
          `Valid values: ${validTiers.join(', ')}. Ignoring.`
        );
      }
    }

    return true;
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
