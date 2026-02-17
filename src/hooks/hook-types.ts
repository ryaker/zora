/**
 * Lifecycle Hook Types — ORCH-12
 *
 * Defines the typed hook interfaces for Zora's lifecycle hook system.
 * Hooks intercept the orchestration pipeline at key stages:
 *   - onTaskStart: before routing (modify task context)
 *   - beforeToolExecute: before tool call (can block)
 *   - afterToolExecute: after tool call (can modify result)
 *   - onTaskEnd: after completion (can inject follow-up)
 */

import type { TaskContext } from '../types.js';

/**
 * Hook invoked before task routing. Can modify the TaskContext
 * (e.g., inject system prompt additions, change capabilities).
 */
export interface OnTaskStartHook {
  (ctx: TaskContext): Promise<TaskContext>;
}

/**
 * Result from a beforeToolExecute hook.
 * - allow=true: continue execution (optionally with modified args)
 * - allow=false: block the tool call (message explains why)
 */
export interface BeforeToolResult {
  allow: boolean;
  args?: Record<string, unknown>;
  message?: string;
}

/**
 * Hook invoked before each tool execution.
 * Can block the call or modify its arguments.
 */
export interface BeforeToolExecuteHook {
  (toolName: string, args: Record<string, unknown>): Promise<BeforeToolResult>;
}

/**
 * Hook invoked after each tool execution.
 * Can modify the tool result before it's returned to the LLM.
 */
export interface AfterToolExecuteHook {
  (toolName: string, result: unknown): Promise<unknown>;
}

/**
 * Result from an onTaskEnd hook.
 * If followUp is set, the orchestrator re-submits that prompt.
 */
export interface OnTaskEndResult {
  followUp?: string;
}

/**
 * Hook invoked after task completion.
 * Can inspect the result and optionally trigger a follow-up task.
 */
export interface OnTaskEndHook {
  (ctx: TaskContext, result: string): Promise<OnTaskEndResult | void>;
}

/**
 * The four lifecycle hook points available in Zora.
 */
export interface ZoraHooks {
  onTaskStart: OnTaskStartHook[];
  beforeToolExecute: BeforeToolExecuteHook[];
  afterToolExecute: AfterToolExecuteHook[];
  onTaskEnd: OnTaskEndHook[];
}

/**
 * Hook event names for registration and config matching.
 */
export type HookEventName = keyof ZoraHooks;

/**
 * All valid hook event names.
 */
export const HOOK_EVENT_NAMES: readonly HookEventName[] = [
  'onTaskStart',
  'beforeToolExecute',
  'afterToolExecute',
  'onTaskEnd',
] as const;

/**
 * Configuration for a hook defined in config.toml [[hooks]] section.
 */
export interface HookConfig {
  event: HookEventName;
  match?: string;
  script?: string;
}
