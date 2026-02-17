import { describe, it, expect, vi } from 'vitest';
import { ObserverWorker } from '../../../src/memory/observer-worker.js';
import type { AgentEvent } from '../../../src/types.js';

function makeEvents(count: number): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (let i = 0; i < count; i++) {
    events.push({
      type: 'text',
      timestamp: new Date(Date.now() - (count - i) * 60000),
      content: { text: `Message ${i}: The user discussed task ${i}` },
    });
  }
  return events;
}

describe('ObserverWorker', () => {
  it('compresses messages into an observation block', async () => {
    const compressFn = vi.fn().mockResolvedValue(
      '[2026-02-16 14:00] IMPORTANT — User discussed task planning\n' +
      '[2026-02-16 14:01] NOTE — Several messages about project setup',
    );

    const worker = new ObserverWorker(compressFn);
    const events = makeEvents(5);

    const block = await worker.compress(events, 0, '', 'test-session');

    expect(block.tier).toBe('session');
    expect(block.sessionId).toBe('test-session');
    expect(block.sourceMessageRange).toEqual([0, 5]);
    expect(block.observations).toContain('IMPORTANT');
    expect(block.estimatedTokens).toBeGreaterThan(0);
    expect(compressFn).toHaveBeenCalledOnce();
  });

  it('passes existing observations for dedup context', async () => {
    const compressFn = vi.fn().mockResolvedValue('[2026-02-16 15:00] NOTE — New info');

    const worker = new ObserverWorker(compressFn);
    const existingObs = '[2026-02-16 14:00] IMPORTANT — Previous observation';

    await worker.compress(makeEvents(3), 10, existingObs, 'test-session');

    const prompt = compressFn.mock.calls[0]![0] as string;
    expect(prompt).toContain('Previous observation');
    expect(prompt).toContain('do NOT repeat');
  });

  it('uses correct start index in serialized messages', async () => {
    const compressFn = vi.fn().mockResolvedValue('[2026-02-16 14:00] NOTE — Compressed');

    const worker = new ObserverWorker(compressFn);
    await worker.compress(makeEvents(3), 50, '', 'test-session');

    const prompt = compressFn.mock.calls[0]![0] as string;
    expect(prompt).toContain('[50]');
    expect(prompt).toContain('[51]');
    expect(prompt).toContain('[52]');
  });

  it('falls back to basic summary when compressFn fails', async () => {
    const compressFn = vi.fn().mockRejectedValue(new Error('LLM unavailable'));

    const worker = new ObserverWorker(compressFn);
    const events = makeEvents(5);

    const block = await worker.compress(events, 0, '', 'test-session');

    expect(block.observations).toContain('Compressed 5 messages');
    expect(block.observations).toContain('indices 0-4');
    expect(block.estimatedTokens).toBeGreaterThan(0);
  });

  it('serializes different event types correctly', async () => {
    const compressFn = vi.fn().mockResolvedValue('Compressed');

    const events: AgentEvent[] = [
      { type: 'text', timestamp: new Date(), content: { text: 'Hello' } },
      { type: 'tool_call', timestamp: new Date(), content: { tool: 'Read', arguments: { file_path: '/test.ts' } } },
      { type: 'tool_result', timestamp: new Date(), content: { toolCallId: 'tc1', result: 'file contents' } },
      { type: 'error', timestamp: new Date(), content: { message: 'Something failed' } },
    ];

    const worker = new ObserverWorker(compressFn);
    await worker.compress(events, 0, '', 'test-session');

    const prompt = compressFn.mock.calls[0]![0] as string;
    expect(prompt).toContain('[text]');
    expect(prompt).toContain('[tool_call]');
    expect(prompt).toContain('[tool_result]');
    expect(prompt).toContain('[error]');
    expect(prompt).toContain('Read');
    expect(prompt).toContain('Something failed');
  });
});
