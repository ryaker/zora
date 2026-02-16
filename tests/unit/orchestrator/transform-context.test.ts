/**
 * Tests for ORCH-14: transformContext callback
 */

import { describe, it, expect } from 'vitest';
import { defaultTransformContext } from '../../../src/orchestrator/execution-loop.js';
import type { AgentEvent } from '../../../src/types.js';

function makeEvent(type: AgentEvent['type'], content: unknown = {}): AgentEvent {
  return { type, timestamp: new Date(), content };
}

describe('defaultTransformContext — ORCH-14', () => {
  it('returns events unchanged when under maxEvents limit', () => {
    const events = [
      makeEvent('text', { text: 'hello' }),
      makeEvent('tool_call', { tool: 'Read' }),
      makeEvent('tool_result', { result: 'data' }),
    ];

    const result = defaultTransformContext(events, 0);
    expect(result).toHaveLength(3);
  });

  it('trims events to maxEvents when exceeded', () => {
    const events = Array.from({ length: 150 }, (_, i) =>
      makeEvent('text', { text: `event ${i}` }),
    );

    const result = defaultTransformContext(events, 0, 100);
    expect(result).toHaveLength(100);
    // Should keep the LAST 100 events
    expect((result[0]!.content as { text: string }).text).toBe('event 50');
  });

  it('drops thinking events older than 5 turns', () => {
    // Create a mix of events simulating multiple turns
    const events: AgentEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(makeEvent('thinking', { text: `thinking ${i}` }));
      events.push(makeEvent('text', { text: `response ${i}` }));
      events.push(makeEvent('tool_call', { tool: 'Read' }));
    }

    // At turn 10, should drop old thinking events
    const result = defaultTransformContext(events, 10, 200);
    const thinkingEvents = result.filter((e) => e.type === 'thinking');

    // Should have fewer thinking events than the original 30
    expect(thinkingEvents.length).toBeLessThan(30);
  });

  it('preserves recent thinking events', () => {
    const events: AgentEvent[] = [];
    // Add 20 "old" events
    for (let i = 0; i < 20; i++) {
      events.push(makeEvent('thinking', { text: `old thinking ${i}` }));
    }
    // Add 5 "recent" events
    for (let i = 0; i < 5; i++) {
      events.push(makeEvent('thinking', { text: `recent thinking ${i}` }));
      events.push(makeEvent('text', { text: `recent text ${i}` }));
    }

    const result = defaultTransformContext(events, 10, 200);
    // Recent thinking events (last ~15 events) should be preserved
    const recentThinking = result.filter(
      (e) => e.type === 'thinking' && (e.content as { text: string }).text.startsWith('recent'),
    );
    expect(recentThinking.length).toBe(5);
  });

  it('handles empty history', () => {
    const result = defaultTransformContext([], 0);
    expect(result).toEqual([]);
  });

  it('uses default maxEvents of 100', () => {
    const events = Array.from({ length: 150 }, (_, i) =>
      makeEvent('text', { text: `event ${i}` }),
    );

    // Should use default maxEvents=100 when not specified
    const result = defaultTransformContext(events, 0);
    expect(result).toHaveLength(100);
  });

  it('does not drop thinking events at low turn numbers', () => {
    const events = [
      makeEvent('thinking', { text: 'thought 1' }),
      makeEvent('text', { text: 'response 1' }),
      makeEvent('thinking', { text: 'thought 2' }),
      makeEvent('text', { text: 'response 2' }),
    ];

    const result = defaultTransformContext(events, 2);
    expect(result).toHaveLength(4);
    expect(result.filter((e) => e.type === 'thinking')).toHaveLength(2);
  });

  it('accepts a custom maxEvents parameter', () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent('text', { text: `event ${i}` }),
    );

    const result = defaultTransformContext(events, 0, 10);
    expect(result).toHaveLength(10);
  });

  it('preserves non-thinking events during pruning', () => {
    const events: AgentEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(makeEvent('thinking', { text: `thinking ${i}` }));
      events.push(makeEvent('tool_call', { tool: `tool_${i}` }));
      events.push(makeEvent('tool_result', { result: `result_${i}` }));
    }

    const result = defaultTransformContext(events, 10, 200);

    // All tool_call and tool_result events should be preserved
    const toolCalls = result.filter((e) => e.type === 'tool_call');
    const toolResults = result.filter((e) => e.type === 'tool_result');
    expect(toolCalls).toHaveLength(30);
    expect(toolResults).toHaveLength(30);
  });
});

describe('transformContext integration — ORCH-14', () => {
  it('custom transformContext can filter by event type', () => {
    const customTransform = (history: AgentEvent[], _turn: number) => {
      return history.filter((e) => e.type !== 'thinking');
    };

    const events = [
      makeEvent('thinking', { text: 'thought' }),
      makeEvent('text', { text: 'response' }),
      makeEvent('tool_call', { tool: 'Read' }),
    ];

    const result = customTransform(events, 0);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.type !== 'thinking')).toBe(true);
  });

  it('custom transformContext can summarize old events', () => {
    const customTransform = (history: AgentEvent[], _turn: number) => {
      if (history.length <= 5) return history;
      // Keep first event as summary + last 4 events
      const summary = makeEvent('text', { text: `[Summary: ${history.length - 4} earlier events]` });
      return [summary, ...history.slice(-4)];
    };

    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent('text', { text: `event ${i}` }),
    );

    const result = customTransform(events, 5);
    expect(result).toHaveLength(5);
    expect((result[0]!.content as { text: string }).text).toContain('Summary: 16 earlier events');
  });
});
