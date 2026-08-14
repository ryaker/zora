/**
 * MEM-15: Performance benchmarks.
 *
 * TEST-21: these asserted wall-clock budgets and flaked under full-suite
 * parallelism — 1-3 failures on some runs, green in isolation. The history is
 * visible in what the file used to say: every name had drifted from its
 * assertion, because each flake was answered by raising the bound.
 *
 *   `creates 100 items in under 2 seconds`      asserted < 10000ms
 *   `lists 100 items in under 500ms`            asserted <  2000ms
 *   `getItem by ID is under 10ms`               asserted <   200ms
 *   `computes 10000 recency decays in under 10ms`  asserted <  50ms
 *
 * Budgets 4-20x their stated intent are flaky *and* toothless: still tripped by
 * a loaded machine, while a real 4x regression sails through. Raising them
 * again was not an option, so the file is split by what it can actually
 * measure.
 *
 *   - CPU-bound work (scoring, decay, relevance) is measured with
 *     `process.cpuUsage()`, which counts time the process was *running*.
 *     Descheduling under load does not inflate it, so the budgets are tight
 *     again and an accidental O(n^2) still trips them.
 *   - I/O-bound work (create/list/search/loadContext) no longer asserts on
 *     time at all. It was measuring tmpdir throughput, not Zora. The
 *     functional assertions stay: they are the part that was ever worth a
 *     failing build.
 *
 * The CPU measurement depends on vitest's default `forks` pool, where a worker
 * process runs one file at a time — `process.cpuUsage()` is process-wide, so
 * switching to the `threads` pool would silently invalidate it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StructuredMemory } from '../../../src/memory/structured-memory.js';
import { SalienceScorer } from '../../../src/memory/salience-scorer.js';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import type { MemoryConfig } from '../../../src/types.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(): MemoryConfig {
  return {
    long_term_file: 'memory/MEMORY.md',
    daily_notes_dir: 'memory/daily',
    items_dir: 'memory/items',
    categories_dir: 'memory/categories',
    context_days: 3,
    max_context_items: 10,
    max_category_summaries: 5,
    auto_extract_interval: 3600,
  };
}

function makeMemoryItem(index: number): MemoryItem {
  const types: MemoryItem['type'][] = ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'];
  const sources: MemoryItem['source_type'][] = ['user_instruction', 'agent_analysis', 'tool_output'];

  return {
    id: `mem_${Date.now()}_${index.toString(16).padStart(8, '0')}`,
    type: types[index % types.length]!,
    summary: `Performance test memory item ${index}: ${randomSentence(index)}`,
    source: `session-perf-${index % 10}`,
    source_type: sources[index % sources.length]!,
    created_at: new Date(Date.now() - index * 3600000).toISOString(),
    last_accessed: new Date(Date.now() - index * 1800000).toISOString(),
    access_count: index % 20,
    reinforcement_score: 0,
    tags: [`tag-${index % 10}`, `group-${index % 5}`, `perf`],
    category: `coding/perf-${index % 8}`,
  };
}

const WORD_POOL = [
  'typescript', 'javascript', 'python', 'rust', 'golang',
  'logging', 'testing', 'deployment', 'docker', 'kubernetes',
  'react', 'vue', 'angular', 'svelte', 'nextjs',
  'database', 'postgresql', 'mongodb', 'redis', 'sqlite',
  'api', 'graphql', 'rest', 'grpc', 'websocket',
  'security', 'authentication', 'authorization', 'encryption', 'hashing',
  'performance', 'optimization', 'caching', 'indexing', 'compression',
  'framework', 'library', 'module', 'package', 'dependency',
];

function randomSentence(seed: number): string {
  const words: string[] = [];
  for (let i = 0; i < 8; i++) {
    words.push(WORD_POOL[(seed * 7 + i * 13) % WORD_POOL.length]!);
  }
  return words.join(' ');
}

/**
 * TEST-21: CPU milliseconds consumed by `fn`, not wall-clock elapsed.
 *
 * `process.cpuUsage()` reports user+system time actually spent on a CPU. A
 * contended machine makes wall-clock balloon while this stays put, which is
 * what makes a tight budget survivable in a parallel suite.
 */
function cpuMillis(fn: () => void): number {
  const before = process.cpuUsage();
  fn();
  const delta = process.cpuUsage(before);
  return (delta.user + delta.system) / 1000;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Performance Benchmarks — MEM-15', () => {
  describe('Salience scoring performance (in-memory)', () => {
    const scorer = new SalienceScorer();

    // TEST-21: budgets are CPU-ms, set from measurements on an idle container
    // with headroom for slower hardware. They are not derived from the author's
    // CI, so treat a first-run failure on much slower hardware as a budget to
    // re-baseline rather than a regression — but re-baseline from a measured
    // number, not by doubling until green, which is how the old bounds got to
    // 20x their names.
    it('scores 100 items using under 20ms of CPU', () => {
      const items = Array.from({ length: 100 }, (_, i) => makeMemoryItem(i));
      expect(cpuMillis(() => scorer.rankItems(items, 'typescript logging', 10))).toBeLessThan(20);
    });

    it('scores 1000 items using under 100ms of CPU', () => {
      const items = Array.from({ length: 1000 }, (_, i) => makeMemoryItem(i));
      expect(cpuMillis(() => scorer.rankItems(items, 'typescript logging', 10))).toBeLessThan(100);
    });

    /**
     * The shape guard: 10x the items for roughly 10x the work. A quadratic
     * ranking would need ~100x and blow this bound long before a constant
     * factor could.
     */
    it('scores 10000 items using under 600ms of CPU', () => {
      const items = Array.from({ length: 10000 }, (_, i) => makeMemoryItem(i));
      expect(cpuMillis(() => scorer.rankItems(items, 'typescript logging performance', 10))).toBeLessThan(600);
    });

    it('scores an individual item in under 50 microseconds of CPU, amortized', () => {
      const items = Array.from({ length: 1000 }, (_, i) => makeMemoryItem(i));
      const perItem = cpuMillis(() => {
        for (const item of items) scorer.scoreItem(item, 'testing');
      }) / items.length;
      expect(perItem).toBeLessThan(0.05);
    });
  });

  /**
   * TEST-21: these were timing tmpdir throughput, not Zora, and their budgets
   * had drifted to 4-20x their names chasing CI flakes. The timing assertions
   * are gone; what each operation is supposed to *do* is asserted instead,
   * which is the part worth failing a build over. Scale is kept so the work is
   * still realistic.
   */
  describe('Structured memory I/O at scale', () => {
    let itemsDir: string;
    let mem: StructuredMemory;

    beforeEach(async () => {
      itemsDir = path.join(os.tmpdir(), `zora-perf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mem = new StructuredMemory(itemsDir);
      await mem.init();
    });

    afterEach(async () => {
      await fs.rm(itemsDir, { recursive: true, force: true });
    });

    it('creates 100 items, each with a distinct id', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const item = await mem.createItem({
          type: 'knowledge',
          summary: `Performance test item ${i}: ${randomSentence(i)}`,
          source: `session-perf-${i}`,
          source_type: 'agent_analysis',
          tags: [`tag-${i % 10}`, 'perf'],
          category: `coding/perf-${i % 5}`,
        });
        ids.add(item.id);
      }
      // Id collision at volume is the real failure mode here, and it is what a
      // stopwatch never checked.
      expect(ids.size).toBe(100);
      expect(await mem.listItems()).toHaveLength(100);
    });

    it('lists every one of 100 items', async () => {
      // Create items first
      for (let i = 0; i < 100; i++) {
        await mem.createItem({
          type: 'knowledge',
          summary: `List test item ${i}`,
          source: 's',
          source_type: 'agent_analysis',
          tags: ['perf'],
          category: 'coding/perf',
        });
      }

      expect(await mem.listItems()).toHaveLength(100);
    });

    it('searches 100 items and returns matches', async () => {
      for (let i = 0; i < 100; i++) {
        await mem.createItem({
          type: 'knowledge',
          summary: `Search test item ${i}: ${randomSentence(i)}`,
          source: 's',
          source_type: 'agent_analysis',
          tags: ['perf', `group-${i % 5}`],
          category: 'coding/perf',
        });
      }

      const hits = await mem.searchItems('typescript logging');
      // Search over a populated store must return a usable subset, not
      // everything and not nothing.
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.length).toBeLessThanOrEqual(100);
    });

    it('retrieves an item by id', async () => {
      const item = await mem.createItem({
        type: 'knowledge',
        summary: 'Quick retrieval test',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['perf'],
        category: 'coding/perf',
      });

      const fetched = await mem.getItem(item.id);
      expect(fetched?.id).toBe(item.id);
      expect(fetched?.summary).toBe('Quick retrieval test');
    });
  });

  describe('MemoryManager at scale', () => {
    let baseDir: string;
    let manager: MemoryManager;

    beforeEach(async () => {
      baseDir = path.join(os.tmpdir(), `zora-perf-mgr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      manager = new MemoryManager(makeConfig(), baseDir);
      await manager.init();
    });

    afterEach(async () => {
      await fs.rm(baseDir, { recursive: true, force: true });
    });

    it('searchMemory over 100 items honours its result limit', async () => {
      // Populate
      for (let i = 0; i < 100; i++) {
        await manager.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Search perf test ${i}: ${randomSentence(i)}`,
          source: 's',
          source_type: 'agent_analysis',
          tags: [`tag-${i % 10}`, 'perf'],
          category: `coding/perf-${i % 5}`,
        });
      }

      // The limit is the contract a stopwatch never checked: a search that
      // silently returned all 100 would have passed the old timing assertion.
      const results = await manager.searchMemory('typescript testing', 10);
      expect(results.length).toBeLessThanOrEqual(10);
    });

    it('loadContext assembles context from 50 items and a daily note', async () => {
      // Populate items
      for (let i = 0; i < 50; i++) {
        await manager.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Context perf test ${i}: ${randomSentence(i)}`,
          source: 's',
          source_type: 'agent_analysis',
          tags: ['perf'],
          category: `coding/perf-${i % 5}`,
        });
      }

      // Add daily notes
      await manager.appendDailyNote('Performance testing in progress');

      const context = await manager.loadContext();
      expect(context.length).toBeGreaterThan(0);
    });
  });

  describe('Recency decay computation', () => {
    const scorer = new SalienceScorer();

    it('computes 10000 recency decays using under 30ms of CPU', () => {
      const timestamps = Array.from({ length: 10000 }, (_, i) =>
        new Date(Date.now() - i * 86400000).toISOString(),
      );

      expect(cpuMillis(() => {
        for (const ts of timestamps) scorer.recencyDecay(ts);
      })).toBeLessThan(30);
    });
  });

  describe('Relevance scoring computation', () => {
    const scorer = new SalienceScorer();

    it('computes 1000 relevance scores using under 30ms of CPU', () => {
      const items = Array.from({ length: 1000 }, (_, i) => makeMemoryItem(i));

      expect(cpuMillis(() => {
        for (const item of items) scorer.relevanceScore('typescript logging framework', item);
      })).toBeLessThan(30);
    });
  });

  describe('Memory footprint', () => {
    it('1000 in-memory items use reasonable memory', () => {
      const items = Array.from({ length: 1000 }, (_, i) => makeMemoryItem(i));

      // Rough size estimate: JSON serialize all items
      const jsonSize = JSON.stringify(items).length;

      // 1000 items should be well under 1MB as JSON
      expect(jsonSize).toBeLessThan(1_000_000);

      // Average item should be under 500 bytes as JSON
      expect(jsonSize / items.length).toBeLessThan(500);
    });
  });
});
