/**
 * RoutineManager — Manages scheduled and recurring tasks (routines).
 *
 * Spec §5.6 "Cron Routines (Scheduled)" and "Event-Triggered Routines":
 *   - Loads routine definitions from TOML files.
 *   - Schedules tasks using node-cron (trigger = 'cron' or absent).
 *   - Wires file-change triggers via EventTriggerManager (trigger = 'file_change').
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
import { EventTriggerManager } from './event-triggers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('routine-manager');

/**
 * Function signature for submitting routine tasks through the orchestration pipeline.
 * Injected by the Orchestrator at construction time.
 */
export type RoutineTaskSubmitter = (options: {
  prompt: string;
  model?: string;
  maxCostTier?: CostTier;
}) => Promise<string>;

/** Default poll interval for EventTriggerManager (1 second). */
const DEFAULT_POLL_INTERVAL_MS = 1000;

export class RoutineManager {
  private readonly _routinesDir: string;
  private readonly _submitTask: RoutineTaskSubmitter;
  private readonly _scheduledTasks: Map<string, ScheduledTask> = new Map();
  /** EventTriggerManager handles all file_change trigger routines. */
  private readonly _eventTriggers: EventTriggerManager;
  /** Tracks which watch_paths are associated with each routine name for logging. */
  private readonly _watchedRoutines: Map<string, string> = new Map();

  constructor(
    submitTask: RoutineTaskSubmitter,
    baseDir: string = path.join(os.homedir(), '.zora'),
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {
    this._submitTask = submitTask;
    this._routinesDir = path.join(baseDir, 'routines');
    this._eventTriggers = new EventTriggerManager({ pollIntervalMs });
  }

  /**
   * Initializes the routines directory and loads existing routines.
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this._routinesDir, { recursive: true });
    } catch (err) {
      log.error({ dir: this._routinesDir, err }, 'Failed to create routines directory');
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
      log.error({ err }, 'Failed to read routines directory');
    }
  }

  /**
   * Unloads a routine by name, stopping its cron task or file watcher if active.
   * Called at the top of loadRoutine() when reloading an existing routine so that
   * switching trigger types (cron ↔ file_change) does not leave both active.
   */
  private _unloadRoutine(name: string): void {
    if (this._scheduledTasks.has(name)) {
      this._scheduledTasks.get(name)!.destroy();
      this._scheduledTasks.delete(name);
    }
    const prevPath = this._watchedRoutines.get(name);
    if (prevPath) {
      this._eventTriggers.unwatch(prevPath);
      this._watchedRoutines.delete(name);
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
          // Unload any previous registration for this routine name so that
          // switching trigger types does not leave stale cron jobs or watchers.
          this._unloadRoutine(definition.routine.name);

          if (definition.routine.trigger === 'file_change') {
            this.watchRoutine(definition);
          } else if (definition.routine.trigger === 'cron' || definition.routine.trigger === undefined) {
            if (!definition.routine.schedule) {
              log.error(
                { routine: definition.routine.name },
                'Cron routine missing schedule — skipping',
              );
              return;
            }
            this.scheduleRoutine(definition);
          } else {
            log.warn(
              { routine: definition.routine.name, trigger: definition.routine.trigger as string },
              'Unknown trigger type — skipping routine',
            );
          }
        }
      } else {
        log.error({ filePath }, 'Invalid routine definition');
      }
    } catch (err) {
      log.error({ filePath, err }, 'Failed to load routine');
    }
  }

  /**
   * Schedules a routine using node-cron.
   * Passes model_preference and max_cost_tier through the task submitter
   * so the Router can select the appropriate provider.
   */
  scheduleRoutine(definition: RoutineDefinition): void {
    const { routine, task } = definition;

    if (!routine.schedule) {
      log.error(
        { routine: routine.name },
        'Cron routine missing schedule — skipping',
      );
      return;
    }

    // Stop existing task if it exists
    if (this._scheduledTasks.has(routine.name)) {
      this._scheduledTasks.get(routine.name)!.destroy();
      this._scheduledTasks.delete(routine.name);
    }

    const schedule = routine.schedule;
    const scheduledTask = cron.schedule(schedule, async () => {
      try {
        await this._submitTask({
          prompt: task.prompt,
          model: routine.model_preference,
          maxCostTier: routine.max_cost_tier,
        });
      } catch (err) {
        log.error({ routine: routine.name, err }, 'Routine execution failed');
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
   * Registers a file-change triggered routine with the EventTriggerManager.
   * When the watched path changes, the routine's task is submitted through
   * the same RoutineTaskSubmitter used by cron-scheduled routines.
   */
  watchRoutine(definition: RoutineDefinition): void {
    const { routine, task } = definition;

    if (!routine.watch_path) {
      log.error(
        { routine: routine.name },
        'Event-triggered routine missing watch_path — skipping',
      );
      return;
    }

    const debounceMs = this._parseDebounceMs(routine.debounce ?? 0);

    // Unwatch any previous registration for this routine name
    const prevPath = this._watchedRoutines.get(routine.name);
    if (prevPath) {
      this._eventTriggers.unwatch(prevPath);
      this._watchedRoutines.delete(routine.name);
    }

    const watchPath = routine.watch_path.replace(/^~/, os.homedir());

    // Prevent two routines from sharing the same watch_path — the second
    // registration would silently shadow the first, causing dropped callbacks.
    const existingOwner = [...this._watchedRoutines.entries()].find(
      ([, p]) => p === watchPath,
    );
    if (existingOwner) {
      log.error(
        { routine: routine.name, watchPath, existingOwner: existingOwner[0] },
        'watch_path already registered by another routine — skipping',
      );
      return;
    }

    this._eventTriggers.watch(watchPath, debounceMs, (changedPath: string) => {
      log.info({ routine: routine.name, changedPath }, 'File-change event triggered routine');
      void this._submitTask({
        prompt: task.prompt,
        model: routine.model_preference,
        maxCostTier: routine.max_cost_tier,
      }).catch((err: unknown) => {
        log.error({ routine: routine.name, changedPath, err }, 'Event-triggered routine execution failed');
      });
    });

    this._watchedRoutines.set(routine.name, watchPath);
    log.info({ routine: routine.name, watchPath, debounceMs }, 'Registered file-change triggered routine');
  }

  /**
   * Parses a debounce value into milliseconds.
   * Accepts a number (treated as ms directly) or a duration string: "5m", "30s", "500ms".
   * Defaults to 0 on parse failure or when value is 0/"".
   */
  private _parseDebounceMs(debounce: string | number): number {
    if (typeof debounce === 'number') return debounce;
    if (debounce === '0' || debounce === '') return 0;
    const match = debounce.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) {
      log.warn({ debounce }, 'Unrecognised debounce format, defaulting to 0');
      return 0;
    }
    const value = parseInt(match[1]!, 10);
    switch (match[2]) {
      case 'ms': return value;
      case 's':  return value * 1_000;
      case 'm':  return value * 60_000;
      case 'h':  return value * 3_600_000;
      default:   return 0;
    }
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

    if (typeof r['name'] !== 'string' || typeof t['prompt'] !== 'string') {
      return false;
    }

    // 'file_change' trigger requires watch_path; 'cron' (or absent) requires schedule.
    const trigger = r['trigger'];
    if (trigger === 'file_change') {
      if (typeof r['watch_path'] !== 'string') {
        log.error(
          { routine: r['name'] },
          'file_change routine is missing watch_path — rejecting',
        );
        return false;
      }
    } else {
      // cron or absent: schedule is required
      if (typeof r['schedule'] !== 'string') {
        return false;
      }
    }

    // Validate optional max_cost_tier if present
    if (r['max_cost_tier'] !== undefined) {
      const validTiers = ['free', 'included', 'metered', 'premium'];
      if (!validTiers.includes(r['max_cost_tier'] as string)) {
        log.warn({ routine: r['name'], costTier: r['max_cost_tier'], validTiers }, 'Invalid max_cost_tier, ignoring');
      }
    }

    return true;
  }

  /**
   * Stops all scheduled cron tasks and all file-change watchers.
   */
  stopAll(): void {
    for (const task of this._scheduledTasks.values()) {
      // destroy() releases the underlying timer handle so the process can exit.
      // stop() only pauses but keeps the timer alive, preventing process exit.
      task.destroy();
    }
    this._scheduledTasks.clear();

    // Stop all file-change watchers and clear tracking state.
    this._eventTriggers.unwatchAll();
    this._watchedRoutines.clear();
  }

  get scheduledCount(): number {
    return this._scheduledTasks.size;
  }

  /** Number of active file-change watched routines. */
  get watchedCount(): number {
    return this._watchedRoutines.size;
  }
}
