/**
 * ToolHookRunner — Intercepts tool calls at the execution level.
 * Hooks fire before and after every tool call inside an LLM turn.
 * Built-in hooks: ShellSafety, AuditLog, SecretRedact, RateLimit.
 */

import { createLogger } from '../utils/logger.js';
import { toolFilterMatches } from '../security/tool-names.js';

const log = createLogger('tool-hook-runner');

export type ToolHookPhase = 'before' | 'after' | 'both';

export interface ToolCallContext {
  jobId: string;
  tool: string;                          // e.g. "bash", "read_file", "http_request"
  arguments: Record<string, unknown>;
  result?: unknown;                      // only in 'after' phase
  durationMs?: number;                   // only in 'after' phase
}

export interface ToolHookResult {
  allow: boolean;
  modifiedArgs?: Record<string, unknown>; // before phase only — override args
  reason?: string;                         // logged when allow=false
}

export interface ToolHook {
  name: string;
  phase: ToolHookPhase;
  tools?: string[];  // if empty/undefined, applies to all tools
  run(ctx: ToolCallContext): Promise<ToolHookResult>;
}

/**
 * SEC-23: does a hook's `tools` filter cover this tool call?
 *
 * The filters were written against Zora's own lowercase tool vocabulary
 * (`bash`, `shell`, `run_command`) at a time when the hook chain ran over Zora's
 * *observed* event stream. Since SEC-21 the chain runs from the SDK's
 * `PreToolUse` hook, where the tool name is the SDK's — `Bash`, `Read`, `Write`.
 * `['bash', ...].includes('Bash')` is false, so `ShellSafetyHook` — the hook
 * whose entire job is refusing `rm -rf /` and `curl | sh` — matched nothing and
 * was skipped on every real call. `SensitiveFileGuardHook` was unaffected only
 * because it has no `tools` filter and lowercases the name itself.
 *
 * SEC-24 found the same mismatch in `RateLimitHook`, `IrreversibilityScorerHook`,
 * `PolicyEngine` and `validateOutput()`, so the matching rule moved to
 * `src/security/tool-names.ts` and every comparison site in `src/` now shares
 * it. Re-exported here because `ToolHook.tools` filters are its most common
 * caller and the import site should stay obvious.
 */
export { toolFilterMatches };

export class ToolHookRunner {
  private readonly _hooks: ToolHook[] = [];

  register(hook: ToolHook): void {
    this._hooks.push(hook);
    log.debug({ hook: hook.name, phase: hook.phase, tools: hook.tools }, 'tool hook registered');
  }

  /**
   * Run all 'before' hooks. Returns allow=false if any hook blocks.
   *
   * SEC-21: `reason` and `blockedBy` are additive — every existing caller
   * destructures `{ allow, args }` and is unaffected. They exist because this
   * result is now translated into an SDK `PreToolUse` denial, and a denial the
   * model cannot read is a denial it will retry blindly.
   */
  async runBefore(ctx: ToolCallContext): Promise<{
    allow: boolean;
    args: Record<string, unknown>;
    reason?: string;
    blockedBy?: string;
  }> {
    let args = { ...ctx.arguments };

    for (const hook of this._hooks) {
      if (hook.phase !== 'before' && hook.phase !== 'both') continue;
      if (hook.tools && hook.tools.length > 0 && !toolFilterMatches(hook.tools, ctx.tool)) continue;

      const result = await hook.run({ ...ctx, arguments: args });
      if (!result.allow) {
        log.warn({ jobId: ctx.jobId, tool: ctx.tool, hook: hook.name, reason: result.reason }, 'tool call blocked');
        return { allow: false, args, reason: result.reason, blockedBy: hook.name };
      }
      if (result.modifiedArgs) {
        args = { ...args, ...result.modifiedArgs };
      }
    }

    return { allow: true, args };
  }

  /** Run all 'after' hooks. Errors are logged but do not throw. */
  async runAfter(ctx: ToolCallContext): Promise<void> {
    for (const hook of this._hooks) {
      if (hook.phase !== 'after' && hook.phase !== 'both') continue;
      if (hook.tools && hook.tools.length > 0 && !toolFilterMatches(hook.tools, ctx.tool)) continue;

      try {
        await hook.run(ctx);
      } catch (err) {
        log.error({ jobId: ctx.jobId, tool: ctx.tool, hook: hook.name, err }, 'after-hook error');
      }
    }
  }
}
