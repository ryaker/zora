/**
 * RateLimitHook — Throttles per-tool call rates using a sliding window.
 */

import type { ToolHook, ToolCallContext, ToolHookResult } from '../tool-hook-runner.js';
import { normalizeToolName, toolFilterMatches } from '../../security/tool-names.js';

export interface RateLimitConfig {
  /**
   * The tool this limit applies to, or `'*'` for every tool.
   *
   * Matched with `toolFilterMatches()`, so `'bash'` covers the SDK's `Bash` and
   * an MCP-qualified name matches on its base. Write it in whichever vocabulary
   * reads best at the registration site.
   */
  tool: string;
  maxCalls: number;
  windowMs: number;
}

export class RateLimitHook implements ToolHook {
  name = 'rate-limit';
  phase = 'before' as const;

  private readonly _windows = new Map<string, number[]>();

  constructor(private readonly _limits: RateLimitConfig[]) {}

  async run(ctx: ToolCallContext): Promise<ToolHookResult> {
    // SEC-24: this used to be `l.tool === ctx.tool`. The orchestrator registers
    // `{ tool: 'bash', maxCalls: 60, windowMs: 60_000 }` and the SDK calls the
    // tool `Bash`, so the strict comparison never matched and the shell rate
    // limit had never throttled a single real call. Same root cause as SEC-23's
    // ShellSafetyHook: two spellings, no shared normaliser.
    const limit = this._limits.find(l => l.tool === '*' || toolFilterMatches([l.tool], ctx.tool));
    if (!limit) return { allow: true };

    const now = Date.now();
    // Window key is normalised too, so a provider that reports `Bash` and one
    // that reports `bash` share a budget instead of getting one each.
    const key = normalizeToolName(ctx.tool);
    const calls = (this._windows.get(key) ?? []).filter(t => now - t < limit.windowMs);
    calls.push(now);
    this._windows.set(key, calls);

    if (calls.length > limit.maxCalls) {
      return {
        allow: false,
        reason: `Rate limit: ${ctx.tool} exceeds ${limit.maxCalls} calls per ${limit.windowMs}ms`,
      };
    }

    return { allow: true };
  }
}
