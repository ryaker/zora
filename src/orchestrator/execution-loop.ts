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
} from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '../providers/index.js';

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

export interface ZoraExecutionOptions {
  systemPrompt?: string;
  cwd?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  mcpServers?: Record<string, Record<string, unknown>>;
  agents?: Record<string, SdkAgentDefinition>;
  hooks?: Partial<Record<string, SdkHookMatcher[]>>;
  canUseTool?: SdkCanUseTool;
  permissionMode?: SdkPermissionMode;
  onMessage?: (message: SDKMessage) => void;
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
   */
  async run(prompt: string): Promise<string> {
    let result = '';
    let sessionId: string | undefined;

    const sdkOptions: Record<string, unknown> = {
      allowedTools: this._opts.allowedTools ?? DEFAULT_TOOLS,
      permissionMode: this._opts.permissionMode ?? 'default',
      mcpServers: this._opts.mcpServers ?? {},
      agents: this._opts.agents ?? {},
      systemPrompt: this._opts.systemPrompt,
      cwd: this._opts.cwd ?? process.cwd(),
      model: this._opts.model,
      maxTurns: this._opts.maxTurns,
      hooks: this._opts.hooks ?? {},
      canUseTool: this._opts.canUseTool,
      settingSources: ['user', 'project'],
    };

    for await (const message of query({ prompt, options: sdkOptions as any })) {
      // Capture session ID from init message
      if ('session_id' in message && !sessionId) {
        sessionId = (message as any).session_id;
      }

      // Notify listener if registered
      if (this._opts.onMessage) {
        this._opts.onMessage(message);
      }

      // Extract final result
      if ('result' in message && typeof (message as any).result === 'string') {
        result = (message as any).result;
      }
    }

    return result;
  }

  /**
   * Returns the SDK options for inspection/testing.
   */
  get options(): ZoraExecutionOptions {
    return this._opts;
  }
}
