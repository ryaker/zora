/**
 * R20: Test GeminiProvider _parseToolCalls() against real output fixtures.
 *
 * Validates XML and markdown JSON patterns against actual Gemini CLI
 * output samples to ensure correct parsing.
 */

import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../../../src/providers/gemini-provider.js';
import {
  XML_TOOL_CALL_SAMPLE,
  MULTI_XML_TOOL_CALL_SAMPLE,
  MARKDOWN_JSON_TOOL_CALL_SAMPLE,
  MULTI_MARKDOWN_JSON_TOOL_CALL_SAMPLE,
  NO_TOOL_CALL_SAMPLE,
  MALFORMED_XML_TOOL_CALL_SAMPLE,
  MALFORMED_MARKDOWN_JSON_SAMPLE,
  MIXED_FORMAT_SAMPLE,
  SINGLE_QUOTED_XML_SAMPLE,
} from '../../fixtures/gemini-output-samples.js';

// Access the private method for testing
function parseToolCalls(text: string): any[] {
  const provider = new GeminiProvider({
    config: {
      name: 'test-gemini',
      type: 'gemini-cli',
      rank: 2,
      capabilities: ['reasoning'],
      cost_tier: 'free',
      enabled: true,
    },
  });
  return (provider as any)._parseToolCalls(text);
}

describe('GeminiProvider Tool Parsing (R20)', () => {
  describe('XML format parsing', () => {
    it('should parse a single XML tool call', () => {
      const calls = parseToolCalls(XML_TOOL_CALL_SAMPLE);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('Read');
      expect(calls[0].arguments.file_path).toBe('/home/user/project/src/index.ts');
      expect(calls[0].toolCallId).toMatch(/^call_/);
    });

    it('should parse multiple XML tool calls', () => {
      const calls = parseToolCalls(MULTI_XML_TOOL_CALL_SAMPLE);
      expect(calls).toHaveLength(2);
      expect(calls[0].tool).toBe('Read');
      expect(calls[0].arguments.file_path).toBe('/home/user/project/src/a.ts');
      expect(calls[1].tool).toBe('Read');
      expect(calls[1].arguments.file_path).toBe('/home/user/project/src/b.ts');
    });

    it('should parse single-quoted XML attributes', () => {
      const calls = parseToolCalls(SINGLE_QUOTED_XML_SAMPLE);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('Glob');
      expect(calls[0].arguments.pattern).toBe('**/*.ts');
    });
  });

  describe('Markdown JSON format parsing', () => {
    it('should parse a markdown JSON tool call', () => {
      const calls = parseToolCalls(MARKDOWN_JSON_TOOL_CALL_SAMPLE);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('Write');
      expect(calls[0].arguments.file_path).toBe('/home/user/project/output.txt');
      expect(calls[0].arguments.content).toBe('Hello World');
    });

    it('should parse multiple markdown JSON tool calls', () => {
      const calls = parseToolCalls(MULTI_MARKDOWN_JSON_TOOL_CALL_SAMPLE);
      expect(calls).toHaveLength(2);
      expect(calls[0].tool).toBe('Write');
      expect(calls[1].tool).toBe('Write');
    });
  });

  describe('Edge cases', () => {
    it('should return empty array for plain text with no tool calls', () => {
      const calls = parseToolCalls(NO_TOOL_CALL_SAMPLE);
      expect(calls).toHaveLength(0);
    });

    it('should skip malformed XML tool calls gracefully', () => {
      const calls = parseToolCalls(MALFORMED_XML_TOOL_CALL_SAMPLE);
      expect(calls).toHaveLength(0);
    });

    it('should skip malformed markdown JSON gracefully', () => {
      const calls = parseToolCalls(MALFORMED_MARKDOWN_JSON_SAMPLE);
      expect(calls).toHaveLength(0);
    });

    it('should prefer XML over markdown JSON when both present', () => {
      const calls = parseToolCalls(MIXED_FORMAT_SAMPLE);
      // XML should be parsed first, and since XML calls exist,
      // markdown JSON is skipped
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('Bash');
    });
  });
});
