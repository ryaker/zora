/**
 * memory_search ontology expansion (#194c).
 *
 * The graph only proposes memory IDs. A proposed ID is returned only if it
 * resolves through the normal read path and passes the caller's filters; there
 * is no visibility policy (retrieval is not an authorization point, #184 c); flag off / client absent / client throwing all
 * degrade to plain lexical search.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { toZodInputSchema } from '../../../src/tools/zora-mcp-server.js';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import { createMemoryTools } from '../../../src/tools/memory-tools.js';
import { GraphMemoryClient } from '../../../src/memory/graph/index.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';

function item(id: string, type: MemoryItem['type'] = 'knowledge'): MemoryItem {
  return {
    id, type, summary: `summary ${id} Zora SparrowDB`, source: 's', source_type: 'agent_analysis',
    created_at: '2026-01-01T00:00:00Z', last_accessed: '2026-01-01T00:00:00Z',
    access_count: 0, reinforcement_score: 0, tags: [], category: 'c',
  };
}

function setup(opts: {
  store: Record<string, MemoryItem>;
  lexical?: string[];
  graph?: Partial<{
    ontologyEnabled: boolean;
    sourcesOfChecked: ReturnType<typeof vi.fn>;
    relationSourcesChecked: ReturnType<typeof vi.fn>;
  }> | null;
  graphScore?: number;
}) {
  const mm = {
    structuredMemory: { peekItem: async (id: string) => opts.store[id] ?? null },
    scoreMemoryItem: () => ({ score: opts.graphScore ?? 0.4 }),
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
    const sourcesOfChecked = vi.fn(async () => ['m2']);
    const run = setup({
      store: { m1: item('m1'), m2: item('m2') }, lexical: ['m1'],
      graph: { ontologyEnabled: true, sourcesOfChecked },
    });
    const r = await run({ query: 'q', entity: ENTITY });
    expect(r.results.map(x => x.id)).toEqual(['m1', 'm2']);
    expect(r.results[1]!.via).toBe('graph');
    expect(sourcesOfChecked).toHaveBeenCalledWith('Zora', 'project', 20);
  });

  it('adds relation-evidenced memories', async () => {
    const relationSourcesChecked = vi.fn(async () => ['m3']);
    const run = setup({
      store: { m3: item('m3') }, graph: { ontologyEnabled: true, relationSourcesChecked },
    });
    const rel = { from: ENTITY, to: { name: 'SparrowDB', kind: 'tool' }, predicate: 'uses' };
    const r = await run({ query: 'q', relation: rel });
    expect(r.results.map(x => x.id)).toEqual(['m3']);
    expect(relationSourcesChecked).toHaveBeenCalledWith(rel.from, rel.to, 'uses', 20);
  });

  it('never cites an ID that does not resolve (forgotten/archived/invented)', async () => {
    const run = setup({
      store: { m1: item('m1') },
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['ghost', 'm1']) },
    });
    const r = await run({ query: 'q', entity: ENTITY });
    expect(r.results.map(x => x.id)).toEqual(['m1']);
  });

  it('applies the type filter to graph candidates', async () => {
    const run = setup({
      store: { a: item('a', 'event'), b: item('b', 'knowledge') },
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['a', 'b']) },
    });
    const r = await run({ query: 'q', entity: ENTITY, type: 'knowledge' });
    expect(r.results.map(x => x.id)).toEqual(['b']);
  });

  it('does not duplicate an item lexical search already returned', async () => {
    const run = setup({
      store: { m1: item('m1') }, lexical: ['m1'],
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['m1']) },
    });
    expect((await run({ query: 'q', entity: ENTITY })).results).toHaveLength(1);
  });

  it('is inert when the ontology flag is off (graph never queried)', async () => {
    const sourcesOfChecked = vi.fn(async () => ['m2']);
    const run = setup({
      store: { m1: item('m1'), m2: item('m2') }, lexical: ['m1'],
      graph: { ontologyEnabled: false, sourcesOfChecked },
    });
    const r = await run({ query: 'q', entity: ENTITY });
    expect(r.results.map(x => x.id)).toEqual(['m1']);
    expect(sourcesOfChecked).not.toHaveBeenCalled();
  });

  it('is inert with no graph client', async () => {
    const run = setup({ store: { m1: item('m1') }, lexical: ['m1'], graph: null });
    expect((await run({ query: 'q', entity: ENTITY })).results.map(x => x.id)).toEqual(['m1']);
  });

  it('ignores malformed entity/relation input', async () => {
    const sourcesOfChecked = vi.fn(async () => ['m2']);
    const run = setup({
      store: { m2: item('m2') }, graph: { ontologyEnabled: true, sourcesOfChecked, relationSourcesChecked: vi.fn() },
    });
    const r = await run({ query: 'q', entity: { name: 'Zora', kind: 'bogus' }, relation: { predicate: 'x' } });
    expect(sourcesOfChecked).not.toHaveBeenCalled();
    expect(r.results).toEqual([]);
  });

  it('falls back to lexical results when the graph throws', async () => {
    const run = setup({
      store: { m1: item('m1') }, lexical: ['m1'],
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => { throw new Error('boom'); }) },
    });
    expect((await run({ query: 'q', entity: ENTITY })).results.map(x => x.id)).toEqual(['m1']);
  });

  it('labels tool_output graph hits as data instead of excluding them', async () => {
    const run = setup({
      store: { b: { ...item('b'), source_type: 'tool_output' } },
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['b']) },
    });
    const r = (await run({ query: 'q', entity: ENTITY })).results[0]!;
    expect(r.id).toBe('b');
    expect(r.source_type).toBe('tool_output');
    expect(r.via).toBe('graph');
  });

  it('drops stale candidates whose current content no longer mentions the entity', async () => {
    const run = setup({
      store: { a: { ...item('a'), summary: 'edited: nothing relevant' }, b: item('b') },
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['a', 'b']) },
    });
    expect((await run({ query: 'q', entity: ENTITY })).results.map(x => x.id)).toEqual(['b']);
  });

  it('rejects malformed IDs from the graph', async () => {
    const run = setup({
      store: { ok: item('ok') },
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['../x', 'a/b', 42 as never, 'ok']) },
    });
    expect((await run({ query: 'q', entity: ENTITY })).results.map(x => x.id)).toEqual(['ok']);
  });

  it('never exceeds the caller limit (lexical + graph)', async () => {
    const store: Record<string, MemoryItem> = {};
    for (const id of ['l1', 'g1', 'g2', 'g3']) store[id] = item(id);
    const run = setup({
      store, lexical: ['l1'],
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['g1', 'g2', 'g3']) },
    });
    expect((await run({ query: 'q', entity: ENTITY, limit: 2 })).results.map(x => x.id)).toEqual(['l1', 'g1']);
  });

  it('scores graph hits so min_score applies to them', async () => {
    const run = setup({
      store: { m1: item('m1'), m2: item('m2') }, lexical: ['m1'], graphScore: 0.2,
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['m2']) },
    });
    expect((await run({ query: 'q', entity: ENTITY, min_score: 0.5 })).results.map(x => x.id)).toEqual(['m1']);
    const strong = setup({
      store: { m1: item('m1'), m2: item('m2') }, lexical: ['m1'], graphScore: 0.6,
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['m2']) },
    });
    const r = await strong({ query: 'q', entity: ENTITY, min_score: 0.5 });
    expect(r.results.map(x => x.id)).toEqual(['m1', 'm2']);
    expect(typeof r.results[1]!.score).toBe('number');
  });

  it('boosts lexical hits connected to the entity above unconnected ones', async () => {
    const run = setup({
      store: { a: item('a'), b: item('b') }, lexical: ['a', 'b'],
      graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['b']) },
    });
    const r = (await run({ query: 'q', entity: ENTITY })).results;
    expect(r.map(x => x.id)).toEqual(['b', 'a']);
    expect(r[0]!.via).toBe('graph');
    expect(r[1]!.via).toBeUndefined();
  });

  it('shares one budget across entity and relation lookups', async () => {
    const store: Record<string, MemoryItem> = {};
    const ids = Array.from({ length: 40 }, (_, i) => 'e' + i);
    for (const id of [...ids, 'r1']) store[id] = item(id);
    const relationSourcesChecked = vi.fn(async () => ['r1']);
    const run = setup({
      store, graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async (_n, _k, lim: number) => ids.slice(0, lim)), relationSourcesChecked },
    });
    const rel = { from: ENTITY, to: { name: 'SparrowDB', kind: 'tool' }, predicate: 'uses' };
    const r = await run({ query: 'q', entity: ENTITY, relation: rel, limit: 50 });
    expect(r.results).toHaveLength(20);
    expect(relationSourcesChecked).not.toHaveBeenCalled(); // budget exhausted by entity lookup
  });

  it('discards the whole graph batch when the second lookup fails', async () => {
    const run = setup({
      store: { m1: item('m1'), m2: item('m2') }, lexical: ['m1'],
      graph: {
        ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['m2']),
        relationSourcesChecked: vi.fn(async () => { throw new Error('boom'); }),
      },
    });
    const rel = { from: ENTITY, to: { name: 'SparrowDB', kind: 'tool' }, predicate: 'uses' };
    expect((await run({ query: 'q', entity: ENTITY, relation: rel })).results.map(x => x.id)).toEqual(['m1']);
  });

  it('marks graph hits provisional', async () => {
    const run = setup({ store: { m2: item('m2') }, graph: { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => ['m2']) } });
    expect((await run({ query: 'q', entity: ENTITY })).results[0]!.provisional).toBe(true);
  });

  it('registered input schema accepts nested entity/relation and rejects bad kinds', () => {
    const tools = createMemoryTools({ structuredMemory: {} } as never, {} as never, null);
    const schema = toZodInputSchema(tools.find(t => t.name === 'memory_search')!.input_schema as never, 'memory_search');
    const rel = { from: ENTITY, to: { name: 'S', kind: 'tool' }, predicate: 'uses' };
    expect(schema.safeParse({ query: 'q', entity: ENTITY, relation: rel }).success).toBe(true);
    expect(schema.safeParse({ query: 'q', entity: { name: 'Z', kind: 'bogus' } }).success).toBe(false);
  });

  it('a forgotten memory in a real store is no longer returned', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-194c-'));
    try {
      const mm = new MemoryManager({
        long_term_file: 'memory/MEMORY.md', daily_notes_dir: 'memory/daily', items_dir: 'memory/items',
        categories_dir: 'memory/categories', context_days: 7, max_context_items: 50,
        max_category_summaries: 10, auto_extract_interval: 3600, auto_extract: true,
      }, dir);
      await mm.init();
      const saved = await mm.structuredMemory.createItem({
        type: 'knowledge', summary: 'Zora uses SparrowDB for graph memory',
        source: 't', source_type: 'agent_analysis', tags: [], category: 'c',
      } as never);
      const graph = { ontologyEnabled: true, sourcesOfChecked: vi.fn(async () => [saved.id]) };
      const search = createMemoryTools(mm, {} as never, graph as never)
        .find(t => t.name === 'memory_search')!;
      const before = await search.handler({ query: 'zzzunmatched', entity: ENTITY }) as { results: Array<{ id: string }> };
      expect(before.results.map(r => r.id)).toContain(saved.id);
      // Real scorer, graph-only match sharing no query words: a positive floor must keep it.
      const floored = await search.handler({ query: 'zzzunmatched', entity: ENTITY, min_score: 0.2 }) as
        { results: Array<{ id: string; score: number; via?: string }> };
      expect(floored.results.map(r => r.id)).toEqual([saved.id]);
      expect(floored.results[0]!.score).toBeGreaterThanOrEqual(0.2);
      expect(floored.results[0]!.via).toBe('graph');
      await mm.forgetItem(saved.id, 'test');
      const after = await search.handler({ query: 'zzzunmatched', entity: ENTITY }) as { results: unknown[] };
      expect(after.results).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // Real GraphMemoryClient failure-aware path: failure must reach the handler as an
  // error (lexical-only fallback), a genuine empty result must not.
  function realClient(reply: (op: string) => unknown) {
    const c = Object.create(GraphMemoryClient.prototype) as Record<string, unknown>;
    c._config = { ontology: true };
    c._available = true;
    c._query = async (q: { op: string }) => reply(q.op);
    return c;
  }
  const REL = { from: ENTITY, to: { name: 'SparrowDB', kind: 'tool' }, predicate: 'uses' };

  it('real client: underlying failure on the 2nd lookup discards the 1st lookup\'s candidates', async () => {
    const client = realClient(op =>
      op === 'sourcesOf' ? { op, memIds: ['g1'], ok: true } : { op, memIds: [], ok: false });
    const run = setup({
      store: { l1: item('l1'), g1: item('g1') }, lexical: ['l1'], graph: client as never,
    });
    const r = (await run({ query: 'q', entity: ENTITY, relation: REL })).results;
    expect(r.map(x => x.id)).toEqual(['l1']);
    expect(r[0]!.via).toBeUndefined();
  });

  it('real client: an unavailable worker (undefined result) falls back to lexical-only', async () => {
    const client = realClient(() => undefined);
    const run = setup({ store: { l1: item('l1'), g1: item('g1') }, lexical: ['l1'], graph: client as never });
    expect((await run({ query: 'q', entity: ENTITY })).results.map(x => x.id)).toEqual(['l1']);
  });

  it('real client: a genuine empty result is not an error and keeps the other lookup', async () => {
    const client = realClient(op =>
      op === 'sourcesOf' ? { op, memIds: ['g1'], ok: true } : { op, memIds: [], ok: true });
    const run = setup({ store: { g1: item('g1') }, graph: client as never });
    expect((await run({ query: 'q', entity: ENTITY, relation: REL })).results.map(x => x.id)).toEqual(['g1']);
  });
});
