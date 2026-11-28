/** memory_search advisory low-confidence signal (#243): never filters results. */
import { describe, it, expect } from 'vitest';
import { createMemoryTools, LOW_CONFIDENCE_SCORE } from '../../../src/tools/memory-tools.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';

const it1: MemoryItem = {
  id: 'm1', type: 'knowledge', summary: 's', source: 's', source_type: 'agent_analysis',
  created_at: '2026-01-01T00:00:00Z', last_accessed: '2026-01-01T00:00:00Z',
  access_count: 0, reinforcement_score: 0, tags: [], category: 'c',
};

function run(score: number | null) {
  const mm = {
    structuredMemory: { peekItem: async (id: string) => (id === 'm1' ? it1 : null) },
    scoreMemoryItem: () => ({ score: 0 }),
    searchMemory: async () => (score === null ? [] : [{ itemId: 'm1', score, components: {} }]),
  };
  const tool = createMemoryTools(mm as never, {} as never, null as never).find(t => t.name === 'memory_search')!;
  return tool.handler({ query: 'q' }) as Promise<Record<string, unknown>>;
}

describe('memory_search low_confidence', () => {
  it('flags empty results', async () => {
    const r = await run(null);
    expect(r.low_confidence).toBe(true);
  });
  it('flags weak matches but still returns them', async () => {
    const r = await run(LOW_CONFIDENCE_SCORE / 2);
    expect(r.low_confidence).toBe(true);
    expect((r.results as unknown[]).length).toBe(1);
  });
  it('does not flag strong matches', async () => {
    const r = await run(0.9);
    expect(r.low_confidence).toBeUndefined();
  });
});
