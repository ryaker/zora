import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateStructuredTokens,
  estimateEventTokens,
  estimateMessagesTokens,
} from '../../../src/memory/token-estimator.js';
import type { AgentEvent } from '../../../src/types.js';

describe('TokenEstimator', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('estimates tokens for English text (~3.5 chars/token)', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const estimate = estimateTokens(text);
      // 43 chars / 3.5 ≈ 13 tokens (actual GPT tokenizer: ~10)
      expect(estimate).toBeGreaterThan(5);
      expect(estimate).toBeLessThan(25);
    });

    it('handles long text', () => {
      const text = 'word '.repeat(1000);
      const estimate = estimateTokens(text);
      expect(estimate).toBeGreaterThan(500);
      expect(estimate).toBeLessThan(2000);
    });
  });

  describe('estimateStructuredTokens', () => {
    it('uses tighter ratio for JSON-like content', () => {
      const json = '{"key": "value", "count": 42}';
      const structured = estimateStructuredTokens(json);
      const text = estimateTokens(json);
      // Structured ratio (3.0) produces higher estimate than text ratio (3.5)
      expect(structured).toBeGreaterThanOrEqual(text);
    });
  });

  describe('estimateEventTokens', () => {
    it('estimates text events', () => {
      const event: AgentEvent = {
        type: 'text',
        timestamp: new Date(),
        content: { text: 'Hello, how can I help you today?' },
      };
      const tokens = estimateEventTokens(event);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(50);
    });

    it('estimates tool_call events', () => {
      const event: AgentEvent = {
        type: 'tool_call',
        timestamp: new Date(),
        content: {
          toolCallId: 'tc_123',
          tool: 'Read',
          arguments: { file_path: '/home/user/project/src/index.ts' },
        },
      };
      const tokens = estimateEventTokens(event);
      expect(tokens).toBeGreaterThan(0);
    });

    it('estimates tool_result events with large output', () => {
      const event: AgentEvent = {
        type: 'tool_result',
        timestamp: new Date(),
        content: {
          toolCallId: 'tc_123',
          result: 'x'.repeat(10000),
        },
      };
      const tokens = estimateEventTokens(event);
      // 10000 chars / 3.0 ≈ 3333 tokens
      expect(tokens).toBeGreaterThan(2000);
      expect(tokens).toBeLessThan(5000);
    });

    it('handles null/undefined content', () => {
      const event: AgentEvent = {
        type: 'text',
        timestamp: new Date(),
        content: null,
      };
      expect(estimateEventTokens(event)).toBe(0);
    });

    it('handles string content', () => {
      const event: AgentEvent = {
        type: 'text',
        timestamp: new Date(),
        content: 'plain string content',
      };
      expect(estimateEventTokens(event)).toBeGreaterThan(0);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('sums tokens across multiple events', () => {
      const events: AgentEvent[] = [
        { type: 'text', timestamp: new Date(), content: { text: 'Hello' } },
        { type: 'text', timestamp: new Date(), content: { text: 'World' } },
        { type: 'tool_call', timestamp: new Date(), content: { tool: 'Bash', arguments: { command: 'ls' } } },
      ];
      const total = estimateMessagesTokens(events);
      const sum = events.reduce((acc, e) => acc + estimateEventTokens(e), 0);
      expect(total).toBe(sum);
    });

    it('returns 0 for empty array', () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });
  });
});
