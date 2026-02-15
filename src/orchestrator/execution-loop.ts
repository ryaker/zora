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
  createSdkMcpServer,
  type PermissionMode,
  type HookCallback,
  type CanUseTool,
  type AgentDefinition,
  type McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '../providers/index.js';
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
 * These are registered as an in-process MCP server via createSdkMcpServer(),
 * which is the SDK's supported mechanism for custom tools.
 */
export interface CustomToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
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

    // Register custom tools as an in-process MCP server (the SDK's supported mechanism).
    // The old approach of passing { customTools } to sdkOptions was silently ignored.
    const mcpServers: Record<string, McpServerConfig> = {
      ...(this._opts.mcpServers as Record<string, McpServerConfig> ?? {}),
    };

    const customTools = this._opts.customTools ?? [];
    const customToolNames: string[] = [];
    if (customTools.length > 0) {
      const toolDefs = customTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema as Record<string, unknown>,
        handler: async (args: Record<string, unknown>) => {
          const result = await t.handler(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        },
      }));

      mcpServers['zora-tools'] = createSdkMcpServer({
        name: 'zora-tools',
        version: '1.0.0',
        tools: toolDefs,
      });

      customToolNames.push(...customTools.map(t => `mcp__zora-tools__${t.name}`));
    }

    const sdkOptions: Record<string, unknown> = {
      allowedTools: [...(this._opts.allowedTools ?? DEFAULT_TOOLS), ...customToolNames],
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
