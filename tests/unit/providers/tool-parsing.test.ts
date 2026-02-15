/**
 * TEST-05: Provider Tool Parsing Validation
 *
 * Validates tool call parsing across all providers against realistic
 * output formats:
 * - Gemini: XML and markdown JSON (via text parsing)
 * - Ollama: Markdown JSON (via text parsing)
 * - Claude: SDK structured messages (via message mapping)
 *
 * Covers: special characters, escaping, malformed responses,
 * mixed content, multiple tool calls, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../../../src/providers/gemini-provider.js';
import { OllamaProvider } from '../../../src/providers/ollama-provider.js';
import { ClaudeProvider } from '../../../src/providers/claude-provider.js';
import type { ProviderConfig } from '../../../src/types.js';

// ─── Helpers ────────────────────────────────────────────────────────

function makeGeminiProvider(): GeminiProvider {
  return new GeminiProvider({
    config: {
      name: 'test-gemini',
      type: 'gemini-cli',
      rank: 2,
      capabilities: ['reasoning'],
      cost_tier: 'free',
      enabled: true,
    },
  });
}

function makeOllamaProvider(): OllamaProvider {
  return new OllamaProvider({
    config: {
      name: 'test-ollama',
      type: 'ollama',
      rank: 5,
      capabilities: ['reasoning'],
      cost_tier: 'free',
      enabled: true,
      model: 'llama3.2',
    },
  });
}

function parseGeminiToolCalls(text: string): any[] {
  return (makeGeminiProvider() as any)._parseToolCalls(text);
}

function parseOllamaToolCalls(text: string): any[] {
  return (makeOllamaProvider() as any)._parseToolCalls(text);
}

function mapClaudeSDKMessage(message: any): any[] {
  const config: ProviderConfig = {
    name: 'test-claude',
    type: 'claude-sdk',
    rank: 1,
    capabilities: ['reasoning', 'coding'],
    cost_tier: 'metered',
    enabled: true,
  };
  const provider = new ClaudeProvider({ config, queryFn: (() => {}) as any });
  return (provider as any)._mapSDKMessage(message);
}

// ─── Gemini XML Parsing ─────────────────────────────────────────────

describe('Gemini Tool Parsing', () => {
  describe('XML tool calls with special characters', () => {
    it('parses arguments with special characters', () => {
      const text = '<tool_call name="Write">{"file_path": "/tmp/test file (1).txt", "content": "Hello \\"world\\"\\n"}</tool_call>';
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('Write');
      expect(calls[0].arguments.file_path).toBe('/tmp/test file (1).txt');
    });

    it('parses arguments with unicode characters', () => {
      const text = '<tool_call name="Write">{"content": "Hello \\u4e16\\u754c"}</tool_call>';
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(1);
    });

    it('handles nested JSON in arguments', () => {
      const text = '<tool_call name="api_call">{"url": "https://api.example.com", "body": {"key": "value", "nested": {"deep": true}}}</tool_call>';
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].arguments.body).toEqual({ key: 'value', nested: { deep: true } });
    });

    it('parses empty arguments object', () => {
      const text = '<tool_call name="list_files">{}</tool_call>';
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('list_files');
      expect(calls[0].arguments).toEqual({});
    });
  });

  describe('XML with surrounding text content', () => {
    it('extracts tool call embedded in long response', () => {
      const text = `Let me analyze the codebase structure first.

I'll start by reading the main configuration file to understand the project setup.

<tool_call name="Read">{"file_path": "/home/user/project/tsconfig.json"}</tool_call>

This should give me a good overview of the TypeScript configuration being used.`;
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('Read');
    });

    it('handles multiple tool calls interspersed with text', () => {
      const text = `First, let me check the directory:

<tool_call name="Glob">{"pattern": "src/**/*.ts"}</tool_call>

Now I'll read the main entry point:

<tool_call name="Read">{"file_path": "src/index.ts"}</tool_call>

And check for tests:

<tool_call name="Glob">{"pattern": "tests/**/*.test.ts"}</tool_call>`;
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(3);
      expect(calls[0].tool).toBe('Glob');
      expect(calls[1].tool).toBe('Read');
      expect(calls[2].tool).toBe('Glob');
    });
  });

  describe('malformed XML tool calls', () => {
    it('handles invalid JSON content gracefully', () => {
      const text = '<tool_call name="Read">{invalid json}</tool_call>';
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(0);
    });

    it('handles empty content between tags', () => {
      const text = '<tool_call name="Read"></tool_call>';
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(0); // Empty string is not valid JSON
    });

    it('handles truncated XML (no closing tag)', () => {
      const text = '<tool_call name="Read">{"file_path": "test.ts"}';
      const calls = parseGeminiToolCalls(text);
      expect(calls).toHaveLength(0);
    });
  });
});

// ─── Ollama JSON Parsing ────────────────────────────────────────────

describe('Ollama Tool Parsing', () => {
  describe('markdown JSON tool calls', () => {
    it('parses a basic tool call', () => {
      const text = 'Here is the result:\n```json\n{"tool": "shell_exec", "arguments": {"command": "ls -la"}}\n```';
      const calls = parseOllamaToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('shell_exec');
      expect(calls[0].arguments.command).toBe('ls -la');
    });

    it('parses multiple tool calls', () => {
      const text = '```json\n{"tool": "Read", "arguments": {"path": "a.ts"}}\n```\nThen:\n```json\n{"tool": "Read", "arguments": {"path": "b.ts"}}\n```';
      const calls = parseOllamaToolCalls(text);
      expect(calls).toHaveLength(2);
    });

    it('skips JSON without tool/arguments fields', () => {
      const text = '```json\n{"name": "not a tool call", "value": 42}\n```';
      const calls = parseOllamaToolCalls(text);
      expect(calls).toHaveLength(0);
    });

    it('handles tool call with complex arguments', () => {
      const text = '```json\n{"tool": "api_call", "arguments": {"url": "https://api.example.com", "headers": {"Authorization": "Bearer token"}, "body": {"data": [1, 2, 3]}}}\n```';
      const calls = parseOllamaToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].arguments.headers).toEqual({ Authorization: 'Bearer token' });
    });
  });

  describe('edge cases', () => {
    it('returns empty array for plain text', () => {
      const calls = parseOllamaToolCalls('This is just regular text with no code blocks.');
      expect(calls).toHaveLength(0);
    });

    it('skips non-JSON code blocks', () => {
      const text = '```typescript\nconst x = 42;\n```\n```python\nprint("hello")\n```';
      const calls = parseOllamaToolCalls(text);
      expect(calls).toHaveLength(0);
    });

    it('handles malformed JSON in code block', () => {
      const text = '```json\n{broken json\n```';
      const calls = parseOllamaToolCalls(text);
      expect(calls).toHaveLength(0);
    });
  });
});

// ─── Claude SDK Message Mapping ─────────────────────────────────────

describe('Claude SDK Message Mapping', () => {
  describe('assistant messages with tool_use', () => {
    it('maps tool_use content block to tool_call event', () => {
      const message = {
        type: 'assistant',
        uuid: 'msg-1',
        session_id: 'sess-1',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'Read',
              input: { file_path: '/tmp/test.ts' },
            },
          ],
        },
        parent_tool_use_id: null,
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_call');
      expect(events[0].content.toolCallId).toBe('toolu_123');
      expect(events[0].content.tool).toBe('Read');
      expect(events[0].content.arguments).toEqual({ file_path: '/tmp/test.ts' });
    });

    it('maps tool_result content block', () => {
      const message = {
        type: 'assistant',
        uuid: 'msg-2',
        session_id: 'sess-1',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: 'File contents here...',
            },
          ],
        },
        parent_tool_use_id: null,
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].content.toolCallId).toBe('toolu_123');
      expect(events[0].content.result).toBe('File contents here...');
    });

    it('maps multiple content blocks from single message', () => {
      const message = {
        type: 'assistant',
        uuid: 'msg-3',
        session_id: 'sess-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I need to check the file first...' },
            { type: 'text', text: 'Let me read that file.' },
            { type: 'tool_use', id: 'toolu_456', name: 'Read', input: { file_path: 'src/main.ts' } },
          ],
        },
        parent_tool_use_id: null,
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('thinking');
      expect(events[0].content.text).toBe('I need to check the file first...');
      expect(events[1].type).toBe('text');
      expect(events[1].content.text).toBe('Let me read that file.');
      expect(events[2].type).toBe('tool_call');
      expect(events[2].content.tool).toBe('Read');
    });
  });

  describe('result messages', () => {
    it('maps successful result to done event', () => {
      const message = {
        type: 'result',
        subtype: 'success',
        uuid: 'res-1',
        session_id: 'sess-1',
        duration_ms: 5000,
        is_error: false,
        num_turns: 3,
        result: 'Task completed successfully',
        total_cost_usd: 0.05,
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('done');
      expect(events[0].content.text).toBe('Task completed successfully');
      expect(events[0].content.duration_ms).toBe(5000);
      expect(events[0].content.total_cost_usd).toBe(0.05);
    });

    it('maps error result to error event', () => {
      const message = {
        type: 'result',
        subtype: 'error_max_turns',
        uuid: 'res-2',
        session_id: 'sess-1',
        duration_ms: 120000,
        is_error: true,
        num_turns: 200,
        total_cost_usd: 2.50,
        errors: ['Max turns exceeded', 'Task incomplete'],
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].content.message).toBe('Max turns exceeded; Task incomplete');
      expect(events[0].content.subtype).toBe('error_max_turns');
    });

    it('maps error result with no error messages', () => {
      const message = {
        type: 'result',
        subtype: 'error_during_execution',
        uuid: 'res-3',
        session_id: 'sess-1',
        duration_ms: 1000,
        is_error: true,
        num_turns: 1,
        total_cost_usd: 0.01,
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].content.message).toContain('error_during_execution');
    });
  });

  describe('system and user messages', () => {
    it('system message produces no events', () => {
      const message = {
        type: 'system',
        subtype: 'init',
        uuid: 'sys-1',
        session_id: 'sess-1',
        model: 'claude-sonnet-4-5',
        tools: ['Read', 'Write', 'Bash'],
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(0);
    });

    it('user message produces no events', () => {
      const message = {
        type: 'user',
        uuid: 'usr-1',
        session_id: 'sess-1',
        message: 'Hello world',
        parent_tool_use_id: null,
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(0);
    });

    it('unknown message type produces no events', () => {
      const message = {
        type: 'unknown_future_type',
        uuid: 'unk-1',
        session_id: 'sess-1',
      };

      const events = mapClaudeSDKMessage(message);
      expect(events).toHaveLength(0);
    });
  });
});

// ─── Cross-Provider Consistency ─────────────────────────────────────

describe('Cross-Provider Tool Call Format Consistency', () => {
  it('all providers emit toolCallId, tool, and arguments', () => {
    // Gemini XML
    const geminiCalls = parseGeminiToolCalls(
      '<tool_call name="Read">{"file_path": "test.ts"}</tool_call>'
    );
    expect(geminiCalls[0]).toHaveProperty('toolCallId');
    expect(geminiCalls[0]).toHaveProperty('tool');
    expect(geminiCalls[0]).toHaveProperty('arguments');

    // Ollama JSON
    const ollamaCalls = parseOllamaToolCalls(
      '```json\n{"tool": "Read", "arguments": {"file_path": "test.ts"}}\n```'
    );
    expect(ollamaCalls[0]).toHaveProperty('toolCallId');
    expect(ollamaCalls[0]).toHaveProperty('tool');
    expect(ollamaCalls[0]).toHaveProperty('arguments');

    // Claude SDK
    const claudeEvents = mapClaudeSDKMessage({
      type: 'assistant',
      uuid: 'msg-1',
      session_id: 'sess-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'test.ts' } },
        ],
      },
      parent_tool_use_id: null,
    });
    const toolEvent = claudeEvents.find((e: any) => e.type === 'tool_call');
    expect(toolEvent.content).toHaveProperty('toolCallId');
    expect(toolEvent.content).toHaveProperty('tool');
    expect(toolEvent.content).toHaveProperty('arguments');
  });

  it('toolCallId format is consistent (string starting with call_ or toolu_)', () => {
    const geminiCalls = parseGeminiToolCalls(
      '<tool_call name="Read">{"file_path": "test.ts"}</tool_call>'
    );
    expect(geminiCalls[0].toolCallId).toMatch(/^call_/);

    const ollamaCalls = parseOllamaToolCalls(
      '```json\n{"tool": "Read", "arguments": {"file_path": "test.ts"}}\n```'
    );
    expect(ollamaCalls[0].toolCallId).toMatch(/^call_/);
  });
});
