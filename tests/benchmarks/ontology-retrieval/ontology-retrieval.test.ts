import { describe, it, expect } from 'vitest';
import { runBenchmark, summarize, formatTable, K } from './harness.js';
import { MEMORIES, QUESTIONS } from './fixtures.js';

describe('ontology retrieval benchmark (Stage 1, #241)', () => {
  it('fixtures are well-formed: unique keys, gold keys exist, all five question types present', () => {
    const keys = MEMORIES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const q of QUESTIONS) for (const g of q.gold) expect(keys).toContain(g);
    expect(new Set(QUESTIONS.map((q) => q.type)).size).toBe(5);
  });

  it('runs both arms with equal budget and reports per-type recall/precision', async () => {
    const { results } = await runBenchmark();
    expect(results).toHaveLength(QUESTIONS.length);
    for (const r of results) {
      expect(r.armA.length).toBeLessThanOrEqual(K);
      expect(r.armB.length).toBeLessThanOrEqual(K);
    }
    const summary = summarize(results);
    // Printed so a run is a report: `npx vitest run tests/benchmarks/ontology-retrieval`.
    console.log(`\nOntology retrieval benchmark (${MEMORIES.length} memories, k=${K})\n${formatTable(summary)}\n`);
    for (const s of summary) {
      expect(s.a.recall).toBeGreaterThanOrEqual(0);
      expect(s.b.recall).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic across runs', async () => {
    const a = summarize((await runBenchmark()).results);
    const b = summarize((await runBenchmark()).results);
    expect(b).toEqual(a);
  });
});
