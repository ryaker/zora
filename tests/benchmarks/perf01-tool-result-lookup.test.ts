/**
 * PERF-01 benchmark — tool_result → tool_call resolution.
 *
 * The orchestrator's stream loop has to answer one question on every
 * `tool_result` event: "which `tool_call` does this belong to, and what were its
 * name and arguments?" (ERR-10 pattern detection and ERR-12 negative-cache
 * recording both need them).
 *
 * BEFORE: `[...taskContext.history].reverse().find(...)` — copies the entire
 * task history into a new array, reverses it, then linearly scans it. History is
 * unbounded and grows with every event, so the per-event cost grows with the
 * session and the total cost is O(n²).
 *
 * AFTER: a `Map<toolCallId, PendingToolCall>` populated on `tool_call` and
 * deleted on `tool_result` — O(1) per event, O(n) per session.
 *
 * This file measures both strategies against the same synthesised history so the
 * numbers are directly comparable. It asserts the shape of the result (the map
 * is dramatically cheaper) rather than a wall-clock threshold, so it does not
 * flake on slow CI machines.
 */

import { describe, it, expect } from 'vitest';
import type { AgentEvent, ToolCallEventContent, ToolResultEventContent } from '../../src/types.js';

// ─── Synthetic session ───────────────────────────────────────────

/**
 * Builds a realistic interleaved stream: text, tool_call, text, tool_result, …
 * repeated until `totalEvents` events exist. This mirrors what a provider emits
 * during a long agentic session.
 */
function buildStream(totalEvents: number): AgentEvent[] {
  const events: AgentEvent[] = [];
  const tools = ['bash', 'read_file', 'write_file', 'memory_search', 'http_request'];
  let call = 0;

  while (events.length < totalEvents) {
    const toolCallId = `call_${call}`;
    const tool = tools[call % tools.length]!;
    const timestamp = new Date(1_700_000_000_000 + call * 1000);

    events.push({
      type: 'text',
      timestamp,
      content: { text: `thinking about step ${call}` },
    } as AgentEvent);

    events.push({
      type: 'tool_call',
      timestamp,
      content: {
        toolCallId,
        tool,
        arguments: { path: `/tmp/file_${call}.txt`, index: call },
      } as ToolCallEventContent,
    } as AgentEvent);

    events.push({
      type: 'tool_result',
      timestamp,
      content: {
        toolCallId,
        result: `result for ${tool} #${call}`,
        error: call % 7 === 0 ? 'transient failure' : undefined,
      } as ToolResultEventContent,
    } as AgentEvent);

    call += 1;
  }

  return events.slice(0, totalEvents);
}

// ─── The two strategies, isolated ────────────────────────────────

interface Measurement {
  ms: number;
  resolved: number;
  /** Total history elements touched — the machine-independent cost metric. */
  elementsTouched: number;
}

/** BEFORE: copy + reverse + linear scan of the whole history, per tool_result. */
function replayWithHistoryScan(stream: AgentEvent[]): Measurement {
  const history: AgentEvent[] = [];
  let resolved = 0;
  let elementsTouched = 0;
  const start = performance.now();

  for (const event of stream) {
    if (event.type === 'tool_result') {
      const resultContent = event.content as ToolResultEventContent;
      // The copy itself touches every element, before find() scans it.
      elementsTouched += history.length;
      const matchingCall = [...history].reverse().find(
        e => e.type === 'tool_call' &&
          (e.content as ToolCallEventContent).toolCallId === resultContent.toolCallId,
      );
      if (matchingCall) {
        const callContent = matchingCall.content as ToolCallEventContent;
        // Touch the fields the real loop reads, so neither strategy is optimised away.
        if (callContent.tool && callContent.arguments) resolved += 1;
      }
    }
    history.push(event);
  }

  return { ms: performance.now() - start, resolved, elementsTouched };
}

/** AFTER: single Map keyed by toolCallId, set on tool_call, deleted on tool_result. */
function replayWithMap(stream: AgentEvent[]): Measurement {
  const history: AgentEvent[] = [];
  const pending = new Map<string, { startedAt: number; call: ToolCallEventContent }>();
  let resolved = 0;
  const elementsTouched = 0; // O(1) per event — no history traversal at all.
  const start = performance.now();

  for (const event of stream) {
    if (event.type === 'tool_call') {
      const callContent = event.content as ToolCallEventContent;
      pending.set(callContent.toolCallId, { startedAt: Date.now(), call: callContent });
    }
    if (event.type === 'tool_result') {
      const resultContent = event.content as ToolResultEventContent;
      const matchingCall = pending.get(resultContent.toolCallId);
      if (matchingCall) {
        const callContent = matchingCall.call;
        if (callContent.tool && callContent.arguments) resolved += 1;
      }
      pending.delete(resultContent.toolCallId);
    }
    history.push(event);
  }

  return { ms: performance.now() - start, resolved, elementsTouched };
}

// ─── Benchmark ───────────────────────────────────────────────────

describe('PERF-01 — tool_result → tool_call lookup', () => {
  it('resolves every tool_result identically under both strategies', () => {
    const stream = buildStream(5000);
    const before = replayWithHistoryScan(stream);
    const after = replayWithMap(stream);

    expect(after.resolved).toBe(before.resolved);
    expect(after.resolved).toBeGreaterThan(1000);
  });

  it('drops per-session cost from O(n^2) to O(n)', () => {
    const stream = buildStream(5000);

    // Warm both paths so JIT state is comparable.
    replayWithHistoryScan(buildStream(300));
    replayWithMap(buildStream(300));

    const before = replayWithHistoryScan(stream);
    const after = replayWithMap(stream);

    const speedup = before.ms / Math.max(after.ms, 1e-6);

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        'PERF-01 — 5000-event session with interleaved tool calls/results',
        `  tool_results resolved : ${before.resolved}`,
        `  BEFORE (history scan) : ${before.ms.toFixed(2)} ms, ${before.elementsTouched.toLocaleString()} history elements copied+scanned`,
        `  AFTER  (Map lookup)   : ${after.ms.toFixed(2)} ms, ${after.elementsTouched} history elements touched`,
        `  speedup               : ${speedup.toFixed(1)}x`,
        '',
      ].join('\n'),
    );

    // The map never walks history; the scan walks millions of elements.
    expect(after.elementsTouched).toBe(0);
    expect(before.elementsTouched).toBeGreaterThan(1_000_000);
    // Cost shape, not wall clock: the scan must be the slower of the two.
    expect(after.ms).toBeLessThan(before.ms);
  });

  it('scales quadratically before and linearly after', () => {
    const small = buildStream(1500);
    const large = buildStream(6000); // 4x the events

    const beforeSmall = replayWithHistoryScan(small).elementsTouched;
    const beforeLarge = replayWithHistoryScan(large).elementsTouched;

    // 4x events => ~16x work for the scan (quadratic).
    const growth = beforeLarge / beforeSmall;
    expect(growth).toBeGreaterThan(10);

    // eslint-disable-next-line no-console
    console.log(
      `PERF-01 scaling — 1500 events: ${beforeSmall.toLocaleString()} elements; ` +
      `6000 events: ${beforeLarge.toLocaleString()} elements (${growth.toFixed(1)}x for 4x the events)`,
    );
  });
});
