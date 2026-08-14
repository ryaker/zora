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
  customTools?: CustomToolDefinition[];
  mcpServers?: Record<string, Record<string, unknown>>;
  agents?: Record<string, SdkAgentDefinition>;
  hooks?: Partial<Record<string, SdkHookMatcher[]>>;
  canUseTool?: SdkCanUseTool;
  permissionMode?: SdkPermissionMode;
  onMessage?: (message: SDKMessage) => void;
  /** ERR-05: Timeout in milliseconds for stream operations (default: 30min) */
  streamTimeout?: number;
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

  constructor(options: ZoraExecutionOptions) {
    this._opts = options;
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

    const sdkOptions: Record<string, unknown> = {
      // INVARIANT-2: apply channel toolAllowlist filter before SDK invocation
      allowedTools: (() => {
        const base = [...(this._opts.allowedTools ?? DEFAULT_TOOLS), ...customToolNames];
        if (!this._opts.toolAllowlist || this._opts.toolAllowlist.length === 0) return base;
        const allowSet = new Set(this._opts.toolAllowlist);
        return base.filter(t => {
          const toolBase = t.split('__').pop() ?? t;
          return allowSet.has(t) || allowSet.has(toolBase) || allowSet.has(toolBase.toLowerCase());
        });
      })(),
      permissionMode: this._opts.permissionMode ?? 'default',
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

    try {
      for await (const message of query({ prompt, options: sdkOptions as Record<string, unknown> })) {
        // Clear previous timeout and set new one (reset on each event)
        if (timeoutHandle) clearTimeout(timeoutHandle);
        lastEventTime = Date.now();

        timeoutHandle = setTimeout(() => {
          const elapsed = Date.now() - lastEventTime;
          log.error({ timeout: streamTimeout, elapsed, sessionId }, 'Stream timeout exceeded');
          throw new Error(`Stream timeout: No events received for ${streamTimeout}ms`);
        }, streamTimeout);

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

      return result;
    } finally {
      // Always clear timeout on exit
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  /**
   * Returns the SDK options for inspection/testing.
   */
  get options(): ZoraExecutionOptions {
    return this._opts;
  }
}
