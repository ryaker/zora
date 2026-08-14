/**
 * buildZoraMcpServer — the single place Zora-defined tools become SDK tools.
 *
 * SDK-01. There is exactly one supported mechanism for handing custom tools to
 * the Claude Agent SDK: `createSdkMcpServer()` registered under `mcpServers`.
 * Passing a `customTools` key on the options object does nothing — the SDK
 * destructures its options explicitly and the key is dropped on the floor, so
 * a tool registered that way never reaches the model and never reports an error.
 *
 * `ExecutionLoop` learned that the hard way and got it right; `ClaudeProvider`
 * never got the fix back-ported, which meant all twelve Zora tools
 * (check_permissions, request_permissions, memory_search, memory_save,
 * memory_forget, recall_context, list_skills, invoke_skill, plan_workflow,
 * list_subagents, delegate_to_subagent, spawn_zora_agent) were silently absent
 * from the main task path while the system prompt kept telling the model to use
 * them.
 *
 * Both call sites now build their MCP server here, so a tool can never again
 * exist on one path and not the other.
 */

import { createSdkMcpServer, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { createLogger } from '../utils/logger.js';

const log = createLogger('zora-mcp-server');

/**
 * A Zora-defined tool, in Zora's own shape.
 *
 * `input_schema` is a JSON Schema object (snake_case, mirroring the Anthropic
 * tool-definition wire format). The SDK wants a Zod schema — see
 * `toZodInputSchema` below for why that conversion is not optional.
 */
export interface CustomToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

/** The MCP server name every Zora tool is registered under. */
export const ZORA_MCP_SERVER_NAME = 'zora-tools';

/**
 * The SDK exposes MCP tools to the model under `mcp__<server>__<tool>`.
 * Callers need these fully-qualified names to put the tools on an allowlist.
 */
export function qualifyZoraToolName(toolName: string): string {
  return `mcp__${ZORA_MCP_SERVER_NAME}__${toolName}`;
}

/**
 * Convert a Zora JSON Schema into the Zod schema `createSdkMcpServer()` requires.
 *
 * This is load-bearing, and it is not what the SDK-01 write-up assumed. The SDK
 * validates `inputSchema` and accepts only a Zod schema or a Zod raw shape:
 *
 *   `inputSchema must be a Zod schema or raw shape, received an unrecognized object`
 *
 * On 0.2.x the same JSON Schema object was accepted and then silently discarded
 * — the tool was advertised to the model with an empty parameter list, so the
 * model could see the tool but not learn what to pass it. 0.3.x turned that
 * silent degradation into a throw, which is how it surfaced. Either way, passing
 * raw JSON Schema through has never worked; `ExecutionLoop` used the right
 * mechanism with the wrong schema format.
 *
 * A schema we cannot convert degrades to a permissive object rather than taking
 * the whole query down — losing argument hints for one tool beats losing every
 * tool.
 */
export function toZodInputSchema(inputSchema: Record<string, unknown> | undefined, toolName: string): z.ZodType {
  if (!inputSchema || Object.keys(inputSchema).length === 0) {
    return z.object({});
  }
  try {
    return z.fromJSONSchema(inputSchema as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodType;
  } catch (err) {
    log.warn(
      { tool: toolName, err: err instanceof Error ? err.message : String(err) },
      'Could not convert tool input_schema to Zod — registering with a permissive schema',
    );
    return z.object({});
  }
}

export interface ZoraMcpServerResult {
  /**
   * The `mcpServers` value to hand to the SDK: the caller's own servers with
   * `zora-tools` merged in. Empty (or just the caller's servers) when there are
   * no custom tools — we never register an empty server.
   */
  mcpServers: Record<string, McpServerConfig>;

  /** Fully-qualified `mcp__zora-tools__*` names, for allowlist composition. */
  toolNames: string[];
}

/**
 * Wrap Zora's custom tools into an in-process MCP server.
 *
 * @param customTools Zora tool definitions. Undefined/empty is fine — the
 *   result then just passes `baseServers` through untouched.
 * @param baseServers Any MCP servers the caller already configured. Merged
 *   first so an explicitly-configured `zora-tools` cannot shadow ours.
 */
export function buildZoraMcpServer(
  customTools?: CustomToolDefinition[],
  baseServers?: Record<string, McpServerConfig>,
): ZoraMcpServerResult {
  const mcpServers: Record<string, McpServerConfig> = { ...(baseServers ?? {}) };

  if (!customTools || customTools.length === 0) {
    return { mcpServers, toolNames: [] };
  }

  const toolDefs = customTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toZodInputSchema(t.input_schema, t.name),
    handler: async (args: Record<string, unknown>) => {
      // A throwing handler inside an MCP server surfaces as a transport error
      // and can tear down the whole query. Tool failure is ordinary — report it
      // to the model as a tool error and let it recover.
      try {
        const result = await t.handler(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Tool '${t.name}' failed: ${message}` }],
          isError: true,
        };
      }
    },
  }));

  mcpServers[ZORA_MCP_SERVER_NAME] = createSdkMcpServer({
    name: ZORA_MCP_SERVER_NAME,
    version: '1.0.0',
    // `SdkMcpToolDefinition` is generic over a Zod *raw shape*; we hand it a
    // ZodObject, which the SDK accepts and prefers. The cast bridges that
    // generic, not a difference in the data.
    tools: toolDefs as unknown as Parameters<typeof createSdkMcpServer>[0]['tools'],
  });

  return {
    mcpServers,
    toolNames: customTools.map((t) => qualifyZoraToolName(t.name)),
  };
}
