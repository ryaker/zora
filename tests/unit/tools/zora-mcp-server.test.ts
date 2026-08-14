/**
 * SDK-01 regression guard.
 *
 * The bug this covers: `ClaudeProvider` set `sdkOptions['customTools']`, which
 * is not an SDK option. The key was dropped, so all twelve Zora tools were
 * missing from the main task path — silently, with the system prompt still
 * telling the model to call them. These tests assert the only thing that
 * actually matters: every `TaskContext.customTools` entry shows up in the SDK
 * options as an `mcpServers['zora-tools']` tool, with a handler that runs.
 */

import { describe, it, expect, vi } from 'vitest';
import { ClaudeProvider } from '../../../src/providers/claude-provider.js';
import type { SDKMessage, SDKQuery } from '../../../src/providers/claude-provider.js';
import type { TaskContext, AgentEvent, ProviderConfig } from '../../../src/types.js';
import { z } from 'zod';
import {
  buildZoraMcpServer,
  toZodInputSchema,
  qualifyZoraToolName,
  ZORA_MCP_SERVER_NAME,
  type CustomToolDefinition,
} from '../../../src/tools/zora-mcp-server.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const config: ProviderConfig = {
  name: 'claude-test',
  type: 'claude-sdk',
  rank: 1,
  capabilities: ['reasoning'],
  cost_tier: 'metered',
  enabled: true,
};

/**
 * Stands in for the twelve real Zora tools. The names are the real ones so a
 * regression that drops a specific tool is legible in the failure output.
 */
const ZORA_TOOL_NAMES = [
  'check_permissions', 'request_permissions',
  'memory_search', 'memory_save', 'memory_forget', 'recall_context',
  'list_skills', 'invoke_skill', 'plan_workflow',
  'list_subagents', 'delegate_to_subagent', 'spawn_zora_agent',
];

function makeCustomTools(): CustomToolDefinition[] {
  return ZORA_TOOL_NAMES.map((name) => ({
    name,
    description: `The ${name} tool`,
    input_schema: { type: 'object', properties: { q: { type: 'string' } } },
    handler: async (input: Record<string, unknown>) => ({ ran: name, echo: input['q'] }),
  }));
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'job-mcp-1',
    task: 'do the thing',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'coding',
    systemPrompt: 'system',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

/** An SDK query that yields nothing — we only care about the options it was handed. */
function emptyQuery(): SDKQuery {
  const gen = (async function* (): AsyncGenerator<SDKMessage, void> {})();
  return gen as SDKQuery;
}

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<void> {
  for await (const _ of gen) { /* discard */ }
}

/** The shape createSdkMcpServer() returns, as far as these tests need it. */
interface McpInstance {
  type?: string;
  instance?: unknown;
}

/**
 * Pull the registered tool names back out of the object createSdkMcpServer()
 * returned. The SDK wraps an McpServer instance; we walk it rather than trust a
 * private field name, so this test keeps working across SDK versions.
 */
function registeredToolNames(server: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (node instanceof Map) {
      for (const key of node.keys()) if (typeof key === 'string') found.add(key);
      for (const value of node.values()) walk(value, depth + 1);
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // A registry keyed by tool name: values are objects carrying a callback.
      if (
        (key === '_registeredTools' || key === 'tools' || key === '_tools') &&
        value !== null && typeof value === 'object'
      ) {
        for (const toolKey of Object.keys(value as Record<string, unknown>)) found.add(toolKey);
      }
      walk(value, depth + 1);
    }
  };

  walk(server, 0);
  return [...found];
}

// ─── buildZoraMcpServer ──────────────────────────────────────────────

describe('buildZoraMcpServer', () => {
  it('registers every custom tool under the zora-tools server', () => {
    const { mcpServers, toolNames } = buildZoraMcpServer(makeCustomTools());

    expect(mcpServers).toHaveProperty(ZORA_MCP_SERVER_NAME);
    expect(toolNames).toEqual(ZORA_TOOL_NAMES.map(qualifyZoraToolName));

    const registered = registeredToolNames(mcpServers[ZORA_MCP_SERVER_NAME]);
    for (const name of ZORA_TOOL_NAMES) {
      expect(registered, `tool '${name}' missing from the zora-tools MCP server`).toContain(name);
    }
  });

  it('does not register an empty server when there are no custom tools', () => {
    expect(buildZoraMcpServer([]).mcpServers).not.toHaveProperty(ZORA_MCP_SERVER_NAME);
    expect(buildZoraMcpServer(undefined).mcpServers).not.toHaveProperty(ZORA_MCP_SERVER_NAME);
    expect(buildZoraMcpServer(undefined).toolNames).toEqual([]);
  });

  it('preserves caller-supplied MCP servers alongside zora-tools', () => {
    const base = { other: { type: 'stdio', command: 'x' } as never };
    const { mcpServers } = buildZoraMcpServer(makeCustomTools(), base);
    expect(Object.keys(mcpServers).sort()).toEqual(['other', ZORA_MCP_SERVER_NAME].sort());
  });

  it('qualifies names the way the SDK exposes MCP tools to the model', () => {
    expect(qualifyZoraToolName('memory_search')).toBe('mcp__zora-tools__memory_search');
  });
});

// ─── input_schema conversion ─────────────────────────────────────────

describe('toZodInputSchema', () => {
  /**
   * Registering with raw JSON Schema advertises the tool to the model with an
   * empty parameter list (0.2.x) or throws outright (0.3.x). Either way the
   * arguments have to survive the conversion or the tool is useless.
   */
  it('preserves declared parameters, types and requiredness', () => {
    const schema = toZodInputSchema({
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'paths to check' },
        reason: { type: 'string', description: 'why' },
      },
      required: ['reason'],
    }, 'request_permissions');

    expect(schema.safeParse({ reason: 'need it', paths: ['/tmp'] }).success).toBe(true);
    expect(schema.safeParse({ paths: ['/tmp'] }).success, 'required field not enforced').toBe(false);
    expect(schema.safeParse({ reason: 'x', paths: 'not-an-array' }).success).toBe(false);

    // Round-tripping back out is how the SDK describes the tool to the model.
    const advertised = z.toJSONSchema(schema) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(advertised.properties ?? {}).sort()).toEqual(['paths', 'reason']);
    expect(advertised.required).toEqual(['reason']);
  });

  it('handles schemas with no properties', () => {
    expect(toZodInputSchema({ type: 'object' }, 't').safeParse({}).success).toBe(true);
    expect(toZodInputSchema(undefined, 't').safeParse({}).success).toBe(true);
  });

  it('degrades to a permissive schema rather than throwing on an unconvertible schema', () => {
    const schema = toZodInputSchema({ type: 'not-a-real-json-schema-type' }, 'weird_tool');
    expect(schema.safeParse({}).success).toBe(true);
  });

  it('converts every real Zora tool schema without falling back', () => {
    for (const tool of makeCustomTools()) {
      const schema = toZodInputSchema(tool.input_schema, tool.name);
      const advertised = z.toJSONSchema(schema) as { properties?: Record<string, unknown> };
      expect(
        Object.keys(advertised.properties ?? {}),
        `'${tool.name}' lost its parameters in conversion`,
      ).toContain('q');
    }
  });
});

// ─── ClaudeProvider wiring ───────────────────────────────────────────

describe('ClaudeProvider custom tool registration (SDK-01)', () => {
  it('passes customTools through as mcpServers, never as the bogus customTools key', async () => {
    let captured: Record<string, unknown> | undefined;
    const queryFn = vi.fn((params: { prompt: string; options?: Record<string, unknown> }) => {
      captured = params.options;
      return emptyQuery();
    });

    const provider = new ClaudeProvider({ config, queryFn });
    await drain(provider.execute(makeTask({ customTools: makeCustomTools() })));

    expect(captured).toBeDefined();
    // The bug: this key is not part of the SDK's Options type and is discarded.
    expect(captured).not.toHaveProperty('customTools');

    const mcpServers = captured!['mcpServers'] as Record<string, unknown>;
    expect(mcpServers).toBeDefined();
    expect(mcpServers).toHaveProperty(ZORA_MCP_SERVER_NAME);

    const registered = registeredToolNames(mcpServers[ZORA_MCP_SERVER_NAME]);
    for (const name of ZORA_TOOL_NAMES) {
      expect(registered, `tool '${name}' never reached the model`).toContain(name);
    }
  });

  it('keeps the handler attached and executable', async () => {
    const calls: string[] = [];
    const tools: CustomToolDefinition[] = [{
      name: 'memory_search',
      description: 'search',
      input_schema: { type: 'object', properties: { q: { type: 'string' } } },
      handler: async (input) => {
        calls.push(String(input['q']));
        return { hits: 3 };
      },
    }];

    // Go through the builder directly so we can invoke what it produced. The old
    // provider code .map()'d away `handler`, so a tool could not have run even if
    // the option had existed.
    const { mcpServers } = buildZoraMcpServer(tools);
    const handler = findHandler(mcpServers[ZORA_MCP_SERVER_NAME], 'memory_search');
    expect(handler, 'memory_search handler was not registered').toBeTypeOf('function');

    const result = await handler!({ q: 'needle' }, undefined) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(calls).toEqual(['needle']);
    // The handler's return value is serialised into the MCP text content block.
    expect(JSON.parse(result.content[0]!.text)).toEqual({ hits: 3 });
  });

  it('reports a throwing tool as a tool error rather than tearing down the query', async () => {
    const tools: CustomToolDefinition[] = [{
      name: 'invoke_skill',
      description: 'invoke',
      input_schema: { type: 'object' },
      handler: async () => { throw new Error('skill exploded'); },
    }];

    const { mcpServers } = buildZoraMcpServer(tools);
    const handler = findHandler(mcpServers[ZORA_MCP_SERVER_NAME], 'invoke_skill');
    const result = await handler!({}, undefined) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('skill exploded');
  });

  it('adds the zora tool names to an explicit allowedTools filter', async () => {
    let captured: Record<string, unknown> | undefined;
    const provider = new ClaudeProvider({
      config,
      allowedTools: ['Read', 'Bash'],
      queryFn: (params) => { captured = params.options; return emptyQuery(); },
    });

    await drain(provider.execute(makeTask({ customTools: makeCustomTools() })));

    const allowed = captured!['allowedTools'] as string[];
    expect(allowed).toContain('Read');
    for (const name of ZORA_TOOL_NAMES) {
      expect(allowed, `'${name}' would be filtered out of the allowlist`).toContain(qualifyZoraToolName(name));
    }
  });

  it('leaves allowedTools unset when no explicit filter is configured', async () => {
    let captured: Record<string, unknown> | undefined;
    const provider = new ClaudeProvider({
      config,
      queryFn: (params) => { captured = params.options; return emptyQuery(); },
    });

    await drain(provider.execute(makeTask({ customTools: makeCustomTools() })));

    // An allowlist is a filter. Setting it to only the Zora tools would have
    // removed every built-in tool from the model's reach.
    expect(captured).not.toHaveProperty('allowedTools');
  });
});

/** Locate a registered tool's callback inside the SDK's McpServer instance. */
function findHandler(
  server: unknown,
  toolName: string,
): ((args: Record<string, unknown>, extra: unknown) => Promise<unknown>) | undefined {
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): ((a: Record<string, unknown>, e: unknown) => Promise<unknown>) | undefined => {
    if (depth > 8 || node === null || typeof node !== 'object') return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    const entries: Array<[string, unknown]> = node instanceof Map
      ? [...node.entries()].filter((e): e is [string, unknown] => typeof e[0] === 'string')
      : Object.entries(node as Record<string, unknown>);

    for (const [key, value] of entries) {
      if (key === toolName && value !== null && typeof value === 'object') {
        for (const candidate of Object.values(value as Record<string, unknown>)) {
          if (typeof candidate === 'function') {
            return candidate as (a: Record<string, unknown>, e: unknown) => Promise<unknown>;
          }
        }
      }
      const nested = walk(value, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  };

  const instance = (server as McpInstance)?.instance ?? server;
  return walk(instance, 0);
}
