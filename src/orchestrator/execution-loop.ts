/**
 * ExecutionLoop — Wraps the Claude Agent SDK's query() function.
 *
 * Zora v0.6: Replaced the hand-rolled agentic cycle with the SDK's
 * production execution engine. The SDK provides built-in tools
 * (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task),
 * MCP server management, subagent orchestration, hooks, and permissions.
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerEntry } from '../types.js';

// ─── SDK-compatible option types ─────────────────────────────────────

export type SdkPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export type SdkHookCallback = (
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<Record<string, unknown>>;

export interface SdkHookMatcher {
  matcher?: string;
  hooks: SdkHookCallback[];
}

export type SdkCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal },
) => Promise<
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }
>;

export interface SdkAgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}

export interface ZoraExecutionOptions {
  systemPrompt?: string;
  cwd?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  mcpServers?: Record<string, McpServerEntry>;
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
