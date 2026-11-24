/**
 * memory_search ontology expansion (#194c).
 *
 * The graph only proposes memory IDs. These tests pin the policy boundary: a
 * proposed ID is returned only if it resolves through the normal read path and
 * passes the caller's filters; flag off / client absent / client throwing all
 * degrade to plain lexical search.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMemoryTools } from '../../../src/tools/memory-tools.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';

function item(id: string, type: MemoryItem['type'] = 'knowledge'): MemoryItem {
  return {
    id, type, summary: `summary ${id}`, source: 's', source_type: 'agent_analysis',
    created_at: '2026-01-01T00:00:00Z', last_accessed: '2026-01-01T00:00:00Z',
    access_count: 0, reinforcement_score: 0, tags: [], category: 'c',
  };
}

function setup(opts: {
  store: Record<string, MemoryItem>;
  lexical?: string[];
  graph?: Partial<{
    ontologyEnabled: boolean;
    sourcesOf: ReturnType<typeof vi.fn>;
    relationSources: ReturnType<typeof vi.fn>;
  }> | null;
}) {
  const mm = {
    structuredMemory: { peekItem: async (id: string) => opts.store[id] ?? null },
    searchMemory: async () => (opts.lexical ?? []).map(itemId => ({ itemId, score: 0.9, components: {} })),
  };
  const tools = createMemoryTools(mm as never, {} as never, (opts.graph ?? null) as never);
  const search = tools.find(t => t.name === 'memory_search')!;
  return (input: Record<string, unknown>) =>
    search.handler(input) as Promise<{ results: Array<Record<string, unknown>> }>;
}

const ENTITY = { name: 'Zora', kind: 'project' };

describe('memory_search ontology expansion', () => {
  it('adds entity-evidenced memories the lexical search missed, marked via graph', async () => {
    const sourcesOf = vi.fn(async () => ['m2']);
    const run = setup({
      store: { m1: item('m1'), m2: item('m2') }, lexical: ['m1'],
      graph: { ontologyEnabled: true, sourcesOf },
    });
    const r = await run({ query: 'q', entity: ENTITY });
    expect(r.results.map(x => x.id)).toEqual(['m1', 'm2']);
    expect(r.results[1]!.via).toBe('graph');
    expect(sourcesOf).toHaveBeenCalledWith('Zora', 'project', 20);
  });

  it('adds relation-evidenced memories', async () => {
    const relationSources = vi.fn(async () => ['m3']);
    const run = setup({
      store: { m3: item('m3') }, graph: { ontologyEnabled: true, relationSources },
    });
    const rel = { from: ENTITY, to: { name: 'SparrowDB', kind: 'tool' }, predicate: 'uses' };
    const r = await run({ query: 'q', relation: rel });
    expect(r.results.map(x => x.id)).toEqual(['m3']);
    expect(relationSources).toHaveBeenCalledWith(rel.from, rel.to, 'uses', 20);
  });

  it('never cites an ID that does not resolve (forgotten/archived/invented)', async () => {
    const run = setup({
      store: { m1: item('m1') },
      graph: { ontologyEnabled: true, sourcesOf: vi.fn(async () => ['ghost', 'm1']) },
    });
    const r = await run({ query: 'q', entity: ENTITY });
    expect(r.results.map(x => x.id)).toEqual(['m1']);
  });

  it('applies the type filter to graph candidates', async () => {
    const run = setup({
      store: { a: item('a', 'event'), b: item('b', 'knowledge') },
      graph: { ontologyEnabled: true, sourcesOf: vi.fn(async () => ['a', 'b']) },
    });
    const r = await run({ query: 'q', entity: ENTITY, type: 'knowledge' });
    expect(r.results.map(x => x.id)).toEqual(['b']);
  });

  it('does not duplicate an item lexical search already returned', async () => {
    const run = setup({
      store: { m1: item('m1') }, lexical: ['m1'],
      graph: { ontologyEnabled: true, sourcesOf: vi.fn(async () => ['m1']) },
    });
    expect((await run({ query: 'q', entity: ENTITY })).results).toHaveLength(1);
  });

  it('is inert when the ontology flag is off (graph never queried)', async () => {
    const sourcesOf = vi.fn(async () => ['m2']);
    const run = setup({
      store: { m1: item('m1'), m2: item('m2') }, lexical: ['m1'],
      graph: { ontologyEnabled: false, sourcesOf },
    });
    const r = await run({ query: 'q', entity: ENTITY });
    expect(r.results.map(x => x.id)).toEqual(['m1']);
    expect(sourcesOf).not.toHaveBeenCalled();
  });

  it('is inert with no graph client', async () => {
    const run = setup({ store: { m1: item('m1') }, lexical: ['m1'], graph: null });
    expect((await run({ query: 'q', entity: ENTITY })).results.map(x => x.id)).toEqual(['m1']);
  });

  it('ignores malformed entity/relation input', async () => {
    const sourcesOf = vi.fn(async () => ['m2']);
    const run = setup({
      store: { m2: item('m2') }, graph: { ontologyEnabled: true, sourcesOf, relationSources: vi.fn() },
    });
    const r = await run({ query: 'q', entity: { name: 'Zora', kind: 'bogus' }, relation: { predicate: 'x' } });
    expect(sourcesOf).not.toHaveBeenCalled();
    expect(r.results).toEqual([]);
  });

  it('falls back to lexical results when the graph throws', async () => {
    const run = setup({
      store: { m1: item('m1') }, lexical: ['m1'],
      graph: { ontologyEnabled: true, sourcesOf: vi.fn(async () => { throw new Error('boom'); }) },
    });
    expect((await run({ query: 'q', entity: ENTITY })).results.map(x => x.id)).toEqual(['m1']);
  });
});
