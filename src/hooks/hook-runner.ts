/**
 * HookRunner — ORCH-12
 *
 * Executes registered lifecycle hooks in registration order.
 * Accumulates modifications from onTaskStart/afterToolExecute.
 * Short-circuits on beforeToolExecute when allow=false.
 */

import { createLogger } from '../utils/logger.js';
import type { TaskContext } from '../types.js';
import type {
  ZoraHooks,
  HookEventName,
  OnTaskStartHook,
  BeforeToolExecuteHook,
  AfterToolExecuteHook,
  OnTaskEndHook,
  BeforeToolResult,
  OnTaskEndResult,
} from './hook-types.js';

const log = createLogger('hook-runner');

export class HookRunner {
  private readonly _hooks: ZoraHooks = {
    onTaskStart: [],
    beforeToolExecute: [],
    afterToolExecute: [],
    onTaskEnd: [],
  };

  /**
   * Register a hook for a specific lifecycle event.
   */
  on(event: 'onTaskStart', handler: OnTaskStartHook): void;
  on(event: 'beforeToolExecute', handler: BeforeToolExecuteHook): void;
  on(event: 'afterToolExecute', handler: AfterToolExecuteHook): void;
  on(event: 'onTaskEnd', handler: OnTaskEndHook): void;
  on(event: HookEventName, handler: unknown): void {
    const arr = this._hooks[event] as unknown[];
    arr.push(handler);
    log.debug({ event, count: arr.length }, 'Hook registered');
  }

  /**
   * Returns the number of registered hooks for a given event.
   */
  count(event: HookEventName): number {
    return this._hooks[event].length;
  }

  /**
   * Returns all registered hook event names that have at least one handler.
   */
  activeEvents(): HookEventName[] {
    return (Object.keys(this._hooks) as HookEventName[]).filter(
      (event) => this._hooks[event].length > 0,
    );
  }

  /**
   * Lists all registered hooks with their event name and handler count.
   */
  listHooks(): Array<{ event: HookEventName; count: number }> {
    return (Object.keys(this._hooks) as HookEventName[]).map((event) => ({
      event,
      count: this._hooks[event].length,
    }));
  }

  /**
   * Run all onTaskStart hooks in order, accumulating context modifications.
   * Each hook receives the output of the previous one.
   */
  async runOnTaskStart(ctx: TaskContext): Promise<TaskContext> {
    let current = ctx;
    for (const hook of this._hooks.onTaskStart) {
      try {
        current = await hook(current);
      } catch (err) {
        log.error({ err, event: 'onTaskStart' }, 'Hook threw an error');
        // Continue with current context — hooks should not crash the pipeline
      }
    }
    return current;
  }

  /**
   * Run all beforeToolExecute hooks in order.
   * Short-circuits on the first hook that returns allow=false.
   * Accumulates argument modifications across hooks.
   */
  async runBeforeToolExecute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<BeforeToolResult> {
    let currentArgs = args;
    for (const hook of this._hooks.beforeToolExecute) {
      try {
        const result = await hook(toolName, currentArgs);
        if (!result.allow) {
          log.info({ tool: toolName, message: result.message }, 'Tool blocked by beforeToolExecute hook');
          return result;
        }
        if (result.args) {
          currentArgs = result.args;
        }
      } catch (err) {
        log.error({ err, event: 'beforeToolExecute', tool: toolName }, 'Hook threw an error');
        // Continue — do not block on hook errors
      }
    }
    return { allow: true, args: currentArgs };
  }

  /**
   * Run all afterToolExecute hooks in order, piping the result through each.
   */
  async runAfterToolExecute(
    toolName: string,
    result: unknown,
  ): Promise<unknown> {
    let current = result;
    for (const hook of this._hooks.afterToolExecute) {
      try {
        current = await hook(toolName, current);
      } catch (err) {
        log.error({ err, event: 'afterToolExecute', tool: toolName }, 'Hook threw an error');
        // Continue with current result
      }
    }
    return current;
  }

  /**
   * Run all onTaskEnd hooks in order.
   * Returns the first follow-up prompt if any hook provides one.
   */
  async runOnTaskEnd(
    ctx: TaskContext,
    result: string,
  ): Promise<OnTaskEndResult> {
    for (const hook of this._hooks.onTaskEnd) {
      try {
        const hookResult = await hook(ctx, result);
        if (hookResult?.followUp) {
          return hookResult;
        }
      } catch (err) {
        log.error({ err, event: 'onTaskEnd' }, 'Hook threw an error');
      }
    }
    return {};
  }
}
