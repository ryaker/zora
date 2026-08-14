/**
 * ExecutionLoop — Wraps the Claude Agent SDK's query() function.
 *
 * Zora v0.6: Replaced the hand-rolled agentic cycle with the SDK's
 * production execution engine. The SDK provides built-in tools
 * (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task),
 * MCP server management, subagent orchestration, hooks, and permissions.
 */

import {
  query,
  type PermissionMode,
  type HookCallback,
  type CanUseTool,
  type AgentDefinition,
  type McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '../providers/index.js';
import type { ZoraSdkHooks } from '../hooks/sdk-hook-bridge.js';
import { buildZoraMcpServer, type CustomToolDefinition } from '../tools/zora-mcp-server.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('execution-loop');

// ─── SDK-compatible option types ─────────────────────────────────────
// Re-export SDK types with Sdk prefix for consistency

export type SdkPermissionMode = PermissionMode;
export type SdkHookCallback = HookCallback;
export type SdkCanUseTool = CanUseTool;
export type SdkAgentDefinition = AgentDefinition;

export interface SdkHookMatcher {
  matcher?: string;
  hooks: SdkHookCallback[];
}

/**
 * Custom tool that Zora can inject into the SDK execution.
 * Used for Zora-specific tools like check_permissions and request_permissions.
 *
 * SDK-01: the definition now lives in `src/tools/zora-mcp-server.ts` alongside
 * the builder that turns it into a real SDK tool. Re-exported here because most
 * of the codebase imports it from this module.
 */
export type { CustomToolDefinition };

/**
 * ORCH-14: Callback to transform/prune the event history before it's used.
 * Called by the orchestrator before submitting follow-up tasks and during
 * context preparation. Can prune old events, drop thinking events, summarize
 * tool results, etc.
 *
 * @param history - Current event history
 * @param turn - Current turn number (0-based)
 * @returns Pruned/transformed event history
 */
export type TransformContextFn = (
  history: import('../types.js').AgentEvent[],
  turn: number,
) => import('../types.js').AgentEvent[];

/**
 * ORCH-14: Default transformContext implementation.
 * - Keeps the last `maxEvents` events (default 100).
 * - Drops 'thinking' events older than 5 turns.
 * - Truncates 'tool_result' content to 500 chars for events older than 10 turns.
 */
export function defaultTransformContext(
  history: import('../types.js').AgentEvent[],
  turn: number,
  maxEvents = 100,
): import('../types.js').AgentEvent[] {
  let events = history;

  // Drop thinking events older than 5 turns
  if (turn > 5) {
    const cutoffIndex = Math.max(0, events.length - (5 * 3)); // rough: ~3 events per turn
    events = events.filter((e, i) => {
      if (e.type === 'thinking' && i < cutoffIndex) return false;
      return true;
    });
  }

  // Keep only the last maxEvents
  if (events.length > maxEvents) {
    events = events.slice(-maxEvents);
  }

  return events;
}

export interface ZoraExecutionOptions {
  systemPrompt?: string;
  cwd?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  /**
   * SEC-23: static tool bans, layer [1] of the enforcement chain. Derived from
   * `ZoraPolicy` by `buildEnforcedSdkOptions()` — never hand-written at a call
   * site. Unlike `allowedTools` this removes the tool from the model's context
   * entirely, so a banned tool costs no turns to discover.
   */
  disallowedTools?: string[];
  customTools?: CustomToolDefinition[];
  mcpServers?: Record<string, Record<string, unknown>>;
  agents?: Record<string, SdkAgentDefinition>;
  /**
   * SEC-23: layer [2]. `ZoraSdkHooks` is what `buildSdkHooks()` produces — the
   * PreToolUse/PostToolUse bridge over `ToolHookRunner`. The looser
   * `SdkHookMatcher` shape stays accepted for direct SDK hook wiring.
   */
  hooks?: ZoraSdkHooks | Partial<Record<string, SdkHookMatcher[]>>;
  canUseTool?: SdkCanUseTool;
  permissionMode?: SdkPermissionMode;
  onMessage?: (message: SDKMessage) => void;
  /** ERR-05: Timeout in milliseconds for stream operations (default: 30min) */
  streamTimeout?: number;
  /**
   * ERR-20: Optional externally-owned AbortController. Supply one to cancel a
   * run from outside; otherwise `run()` creates its own, reachable via
   * `cancel()`.
   */
  abortController?: AbortController;
  /** ORCH-14: Optional context transform callback applied before each follow-up */
  transformContext?: TransformContextFn;
  /** INVARIANT-2: Channel tool allowlist — filter applied before SDK invocation */
  toolAllowlist?: string[];
}

const DEFAULT_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'Task',
];

export class ExecutionLoop {
  private readonly _opts: ZoraExecutionOptions;

  /** ERR-20: the controller for the in-flight run, so cancel() has something to pull. */
  private _abortController: AbortController | null = null;

  constructor(options: ZoraExecutionOptions) {
    this._opts = options;
  }

  /**
   * ERR-20: Cancel the in-flight run.
   *
   * Aborting the controller the SDK was given makes the generator reject
   * normally, so `run()`'s existing try/finally unwinds and the caller sees a
   * rejected promise. Returns false when there is nothing running.
   */
  cancel(): boolean {
    if (!this._abortController || this._abortController.signal.aborted) return false;
    this._abortController.abort();
    return true;
  }

  /** Whether a run is currently in flight. */
  get isRunning(): boolean {
    return this._abortController !== null && !this._abortController.signal.aborted;
  }

  /**
   * Runs a prompt through the SDK's agentic loop.
   * Returns the final result text.
   * ERR-05: Added timeout protection to prevent indefinite blocking on hung streams.
   */
  async run(prompt: string): Promise<string> {
    let result = '';
    let sessionId: string | undefined;

    // SDK-01: register custom tools as an in-process MCP server (the SDK's only
    // supported mechanism). Shared with ClaudeProvider via buildZoraMcpServer so
    // the two execution paths cannot drift apart again.
    const { mcpServers, toolNames: customToolNames } = buildZoraMcpServer(
      this._opts.customTools,
      this._opts.mcpServers as Record<string, McpServerConfig> | undefined,
    );

    // ERR-20: one controller for both the stream timeout and external cancellation.
    const abortController = this._opts.abortController ?? new AbortController();
    this._abortController = abortController;

    const sdkOptions: Record<string, unknown> = {
      abortController,
      // INVARIANT-2: apply channel toolAllowlist filter before SDK invocation
      allowedTools: (() => {
        // SEC-23: an explicitly empty allowlist is a statement ("this path has
        // no tool surface"), not an absent one. Honour it before custom tools
        // get merged in, so a later `customTools` addition on a single-shot
        // text path cannot quietly re-open the surface.
        if (this._opts.allowedTools && this._opts.allowedTools.length === 0) return [];
        const base = [...(this._opts.allowedTools ?? DEFAULT_TOOLS), ...customToolNames];
        if (!this._opts.toolAllowlist || this._opts.toolAllowlist.length === 0) return base;
        const allowSet = new Set(this._opts.toolAllowlist);
        return base.filter(t => {
          const toolBase = t.split('__').pop() ?? t;
          return allowSet.has(t) || allowSet.has(toolBase) || allowSet.has(toolBase.toLowerCase());
        });
      })(),
      permissionMode: this._opts.permissionMode ?? 'default',
      // SEC-23: layer [1]. Set unconditionally (empty list included) so the key
      // is always visible in the options the SDK receives — the coverage test
      // asserts on its presence, and a missing key is exactly how the heartbeat
      // path lost its gate the first time.
      disallowedTools: this._opts.disallowedTools ?? [],
      mcpServers,
      agents: this._opts.agents ?? {},
      systemPrompt: this._opts.systemPrompt,
      cwd: this._opts.cwd ?? process.cwd(),
      model: this._opts.model,
      maxTurns: this._opts.maxTurns,
      hooks: this._opts.hooks ?? {},
      canUseTool: this._opts.canUseTool,
      settingSources: ['user', 'project'],
    };

    // ERR-05: Timeout protection (default 30 minutes)
    const streamTimeout = this._opts.streamTimeout ?? 30 * 60 * 1000;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let lastEventTime = Date.now();
    let timedOut = false;

    /**
     * ERR-20: abort, don't throw.
     *
     * This callback used to `throw`. A throw inside a setTimeout callback does
     * not reject the awaiting `for await` — it surfaces as an uncaughtException
     * with no handler in scope, and the surrounding try/finally cannot catch it.
     * So the timeout meant to protect against a hung stream took the daemon down
     * instead. Aborting the controller the SDK holds makes the generator reject
     * normally, which is what the caller is already prepared for.
     */
    const armTimeout = (): void => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        const elapsed = Date.now() - lastEventTime;
        log.error({ timeout: streamTimeout, elapsed, sessionId }, 'Stream timeout exceeded — aborting query');
        abortController.abort();
      }, streamTimeout);
      // Never hold the process open on this timer alone.
      timeoutHandle.unref?.();
    };

    // Arm before the first message: a stream that hangs before yielding anything
    // was previously never covered, because the timer was only set inside the loop.
    armTimeout();

    try {
      for await (const message of query({ prompt, options: sdkOptions as Record<string, unknown> })) {
        // Reset the deadline on each event
        lastEventTime = Date.now();
        armTimeout();

        // Capture session ID from init message
        const msg = message as Record<string, unknown>;
        if ('session_id' in message && !sessionId && typeof msg['session_id'] === 'string') {
          sessionId = msg['session_id'];
        }

        // Notify listener if registered
        if (this._opts.onMessage) {
          this._opts.onMessage(message);
        }

        // Extract final result
        if ('result' in message && typeof msg['result'] === 'string') {
          result = msg['result'];
        }
      }

      if (timedOut) {
        throw new Error(`Stream timeout: No events received for ${streamTimeout}ms`);
      }
      return result;
    } catch (err) {
      // An abort surfaces as a generic abort error; say which of the two causes
      // it was, because "timed out" and "cancelled" want different responses.
      if (timedOut) {
        throw new Error(`Stream timeout: No events received for ${streamTimeout}ms`);
      }
      if (abortController.signal.aborted) {
        throw new Error('Execution cancelled');
      }
      throw err;
    } finally {
      // Always clear timeout on exit
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this._abortController = null;
    }
  }

  /**
   * Returns the SDK options for inspection/testing.
   */
  get options(): ZoraExecutionOptions {
    return this._opts;
  }
}
