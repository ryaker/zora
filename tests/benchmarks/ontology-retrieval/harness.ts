/**
 * Offline retrieval benchmark harness (#241, Stage 1).
 *
 * Arm A: lexical memory_search (query only).
 * Arm B: same call plus the entity/relation argument, backed by a graph that
 *        answers from the frozen extractor outputs in fixtures.ts.
 * Both arms go through the REAL createMemoryTools handler and a REAL
 * MemoryManager store, with the same result budget (k) and no min_score, so
 * the only difference is the graph signal. The graph is an in-memory stand-in
 * for GraphStore with the same exact-(kind,name) matching and the same
 * failure-aware client surface; it needs no SparrowDB binary.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import { createMemoryTools } from '../../../src/tools/memory-tools.js';
import { MEMORIES, QUESTIONS, type Ent, type QuestionType } from './fixtures.js';

export const K = 5;

export interface QuestionResult {
  id: string;
  type: QuestionType;
  gold: string[];
  armA: string[];
  armB: string[];
}

export interface Metrics { recall: number; precision: number }

const same = (a: Ent, b: Ent) => a.name === b.name && a.kind === b.kind;

function metrics(returned: string[], gold: string[]): Metrics {
  const hit = returned.filter((k) => gold.includes(k)).length;
  return {
    recall: gold.length === 0 ? 1 : hit / gold.length,
    precision: returned.length === 0 ? 0 : hit / returned.length,
  };
}

export async function runBenchmark(): Promise<{ results: QuestionResult[]; memoryCount: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-241-'));
  try {
    const mm = new MemoryManager({
      long_term_file: 'memory/MEMORY.md', daily_notes_dir: 'memory/daily', items_dir: 'memory/items',
      categories_dir: 'memory/categories', context_days: 7, max_context_items: 50,
      max_category_summaries: 10, auto_extract_interval: 3600, auto_extract: true,
    }, dir);
    await mm.init();

    const idOf = new Map<string, string>();
    const keyOf = new Map<string, string>();
    for (const m of MEMORIES) {
      const saved = await mm.structuredMemory.createItem({
        type: 'knowledge', summary: m.summary, source: 'bench', source_type: 'agent_analysis',
        tags: [], category: 'bench',
      } as never);
      idOf.set(m.key, saved.id);
      keyOf.set(saved.id, m.key);
    }

    const graph = {
      ontologyEnabled: true,
      sourcesOfChecked: async (name: string, kind: string, limit: number) =>
        MEMORIES.filter((m) => m.entities.some((e) => e.name === name && e.kind === kind))
          .slice(0, limit).map((m) => idOf.get(m.key)!),
      relationSourcesChecked: async (from: Ent, to: Ent, predicate: string, limit: number) =>
        MEMORIES.filter((m) => m.relations?.some((r) => same(r.from, from) && same(r.to, to) && r.kind === predicate))
          .slice(0, limit).map((m) => idOf.get(m.key)!),
    };
    const search = createMemoryTools(mm, {} as never, graph as never).find((t) => t.name === 'memory_search')!;
    const run = async (input: Record<string, unknown>) =>
      ((await search.handler({ limit: K, ...input })) as { results: Array<{ id: string }> }).results
        .map((r) => keyOf.get(r.id)!);

    const results: QuestionResult[] = [];
    for (const q of QUESTIONS) {
      const armA = await run({ query: q.query });
      const armB = await run({
        query: q.query,
        ...(q.entity ? { entity: q.entity } : {}),
        ...(q.relation ? { relation: q.relation } : {}),
      });
      results.push({ id: q.id, type: q.type, gold: q.gold, armA, armB });
    }
    return { results, memoryCount: MEMORIES.length };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export interface Summary {
  type: QuestionType | 'all';
  n: number;
  a: Metrics;
  b: Metrics;
  /** Questions where B found a gold item A did not / A found one B lost. */
  fixed: number;
  broken: number;
}

export function summarize(results: QuestionResult[]): Summary[] {
  const types: Array<QuestionType | 'all'> = ['single-hop', 'multi-hop', 'alias', 'temporal', 'provenance', 'all'];
  return types.map((type) => {
    const rs = results.filter((r) => type === 'all' || r.type === type);
    const avg = (arm: 'armA' | 'armB'): Metrics => {
      const ms = rs.map((r) => metrics(r[arm], r.gold));
      return {
        recall: ms.reduce((s, m) => s + m.recall, 0) / ms.length,
        precision: ms.reduce((s, m) => s + m.precision, 0) / ms.length,
      };
    };
    const goldHits = (r: QuestionResult, arm: 'armA' | 'armB') => r[arm].filter((k) => r.gold.includes(k));
    return {
      type, n: rs.length, a: avg('armA'), b: avg('armB'),
      fixed: rs.filter((r) => goldHits(r, 'armB').some((k) => !goldHits(r, 'armA').includes(k))).length,
      broken: rs.filter((r) => goldHits(r, 'armA').some((k) => !goldHits(r, 'armB').includes(k))).length,
    };
  });
}

export function formatTable(summary: Summary[]): string {
  const f = (x: number) => x.toFixed(2);
  const rows = summary.map((s) =>
    `| ${s.type} | ${s.n} | ${f(s.a.recall)} | ${f(s.b.recall)} | ${f(s.a.precision)} | ${f(s.b.precision)} | ${s.fixed} | ${s.broken} |`);
  return [
    `| type | n | recall@${K} A | recall@${K} B | precision@${K} A | precision@${K} B | fixed | broken |`,
    '|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
