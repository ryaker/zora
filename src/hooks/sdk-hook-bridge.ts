/**
 * SDK hook bridge — SEC-21.
 *
 * `ToolHookRunner` holds Zora's real tool-level defenses: SensitiveFileGuard,
 * ShellSafety, AuditLog, RateLimit, SecretRedact, IrreversibilityScorer. Until
 * now it was invoked from the orchestrator's *stream observation* loop — when a
 * `tool_call` event came back from the SDK. That is after the fact. The SDK
 * owns tool execution, so by the time Zora saw the event the tool had already
 * run; a denial synthesised a `tool_result` into Zora's own history array and
 * changed nothing about the world. SensitiveFileGuardHook's "hard-coded,
 * non-bypassable layer" comment was aspirational.
 *
 * The SDK's `PreToolUse` hook is the actual pre-execution seam: a `deny`
 * decision short-circuits ahead of `canUseTool` and the tool is never invoked.
 * This module adapts `ToolHookRunner` onto it without changing the runner's
 * interface — the same hooks, the same order, invoked somewhere they can bite.
 *
 * Two properties worth naming:
 *
 *   - It fails closed. A hook that throws denies the call. Previously an
 *     exception was caught, logged as non-critical, and the tool ran.
 *   - Argument rewrites now reach execution. `SecretRedactHook`'s redaction
 *     used to apply only to what Zora wrote to its own log while the SDK ran
 *     the original arguments; via `updatedInput` the redacted arguments are
 *     what actually execute.
 */

import type { ToolHookRunner } from './tool-hook-runner.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sdk-hook-bridge');

// ─── Structural SDK hook shapes ──────────────────────────────────────
// Declared structurally rather than imported so the bridge is testable
// without constructing a full SDK hook envelope. These are assignable to the
// SDK's own PreToolUseHookInput / PostToolUseHookInput / SyncHookJSONOutput.

export interface PreToolUseInput {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
}

export interface PostToolUseInput {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id?: string;
  duration_ms?: number;
}

export interface PreToolUseHookOutput {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
}

export interface PostToolUseHookOutput {
  hookSpecificOutput?: { hookEventName: 'PostToolUse' };
}

export interface SdkHookMatcher<TInput, TOutput> {
  matcher?: string;
  hooks: Array<(
    input: TInput,
    toolUseID: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<TOutput>>;
}

export interface ZoraSdkHooks {
  PreToolUse?: Array<SdkHookMatcher<PreToolUseInput, PreToolUseHookOutput>>;
  PostToolUse?: Array<SdkHookMatcher<PostToolUseInput, PostToolUseHookOutput>>;
}

/** How the caller supplies the jobId — per-task, so it is a callback not a value. */
export type JobIdResolver = () => string;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
}

// ─── PreToolUse ──────────────────────────────────────────────────────

/**
 * Adapt `ToolHookRunner.runBefore` into an SDK `PreToolUse` hook callback.
 *
 * Returning no `permissionDecision` on the allow path is deliberate: an
 * explicit `'allow'` would short-circuit the SDK's permission flow and skip
 * `canUseTool`, taking the PolicyEngine back out of the path — the exact bug
 * SEC-20 fixed. The hook only ever speaks up to deny or to rewrite arguments.
 */
export function toolHookRunnerToPreToolUse(
  runner: ToolHookRunner,
  getJobId: JobIdResolver,
  onRewrite?: (toolUseId: string, args: Record<string, unknown>) => void,
): (
  input: PreToolUseInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<PreToolUseHookOutput> {
  return async (input, toolUseID) => {
    const jobId = getJobId();
    const originalArgs = asRecord(input.tool_input);

    let outcome: Awaited<ReturnType<ToolHookRunner['runBefore']>>;
    try {
      outcome = await runner.runBefore({
        jobId,
        tool: input.tool_name,
        arguments: originalArgs,
      });
    } catch (err) {
      // Fail closed. A defense layer that errors is not a reason to proceed.
      log.error({ err, jobId, tool: input.tool_name }, 'PreToolUse hook chain threw — denying');
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `Tool '${input.tool_name}' was blocked because a Zora security hook failed to evaluate it.`,
        },
      };
    }

    if (!outcome.allow) {
      const reason = outcome.reason ?? 'blocked by Zora tool policy';
      log.warn(
        { jobId, tool: input.tool_name, hook: outcome.blockedBy },
        'PreToolUse denied tool call',
      );
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `Tool '${input.tool_name}' was blocked by Zora's ${outcome.blockedBy ?? 'security'} hook: ${reason}`,
        },
      };
    }

    // Only speak up when a hook actually rewrote something.
    const rewritten = JSON.stringify(outcome.args) !== JSON.stringify(originalArgs);
    if (!rewritten) return {};

    const id = input.tool_use_id ?? toolUseID;
    if (id && onRewrite) onRewrite(id, outcome.args);

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: outcome.args,
      },
    };
  };
}

// ─── PostToolUse ─────────────────────────────────────────────────────

/**
 * Adapt `ToolHookRunner.runAfter` into an SDK `PostToolUse` hook callback.
 * After-hooks are observational by contract (LeakDetector, audit, negative
 * cache), so this never returns a decision — but it now runs against the real
 * tool response rather than a reconstructed one.
 */
export function toolHookRunnerToPostToolUse(
  runner: ToolHookRunner,
  getJobId: JobIdResolver,
): (
  input: PostToolUseInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<PostToolUseHookOutput> {
  return async (input) => {
    const jobId = getJobId();
    try {
      await runner.runAfter({
        jobId,
        tool: input.tool_name,
        arguments: asRecord(input.tool_input),
        result: input.tool_response,
        durationMs: input.duration_ms,
      });
    } catch (err) {
      // After-hooks cannot block; a failure here must not fail the tool call.
      log.error({ err, jobId, tool: input.tool_name }, 'PostToolUse hook chain threw (non-critical)');
    }
    return {};
  };
}

// ─── Assembly ────────────────────────────────────────────────────────

/**
 * Build the `hooks` option for the SDK from a `ToolHookRunner`.
 * No `matcher` is set, so the hooks apply to every tool — matching is already
 * `ToolHook.tools`' job and duplicating it here would let the two disagree.
 */
export function buildSdkHooks(
  runner: ToolHookRunner,
  getJobId: JobIdResolver,
  onRewrite?: (toolUseId: string, args: Record<string, unknown>) => void,
): ZoraSdkHooks {
  return {
    PreToolUse: [{ hooks: [toolHookRunnerToPreToolUse(runner, getJobId, onRewrite)] }],
    PostToolUse: [{ hooks: [toolHookRunnerToPostToolUse(runner, getJobId)] }],
  };
}

/**
 * A per-task bridge that also remembers what before-hooks rewrote.
 *
 * The orchestrator writes observed `tool_call` events to the session log. It
 * used to get redacted arguments by running the hook chain itself at
 * observation time; now that the chain runs pre-execution inside the SDK,
 * re-running it would double-count rate limits and double-write audit entries.
 * Instead the rewrite is recorded here when it happens and looked up when the
 * event is logged — hooks run exactly once, and secrets still never reach disk.
 */
export class SdkHookBridge {
  readonly hooks: ZoraSdkHooks;
  private readonly _rewrites = new Map<string, Record<string, unknown>>();

  constructor(runner: ToolHookRunner, jobId: string) {
    this.hooks = buildSdkHooks(runner, () => jobId, (toolUseId, args) => {
      this._rewrites.set(toolUseId, args);
    });
  }

  /** Arguments as rewritten by before-hooks, if any. Consumed on read. */
  takeRewrittenInput(toolUseId: string): Record<string, unknown> | undefined {
    const args = this._rewrites.get(toolUseId);
    if (args) this._rewrites.delete(toolUseId);
    return args;
  }
}
