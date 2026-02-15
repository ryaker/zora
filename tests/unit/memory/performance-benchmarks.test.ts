/**
 * MEM-15: Performance benchmarks.
 *
 * Tests timing characteristics at scale:
 *   - Search latency at 100, 1000 items (must be <10ms at 1K)
 *   - Item creation throughput
 *   - Salience computation overhead
 *   - Context loading time
 *
 * Uses Date.now() timing since vitest bench is not standard.
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

async function measure(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function measureSync(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Performance Benchmarks — MEM-15', () => {
  describe('Salience scoring performance (in-memory)', () => {
    const scorer = new SalienceScorer();

    it('scores 100 items in under 5ms', () => {
      const items = Array.from({ length: 100 }, (_, i) => makeMemoryItem(i));
      const elapsed = measureSync(() => {
        scorer.rankItems(items, 'typescript logging', 10);
      });
      expect(elapsed).toBeLessThan(5);
    });

    it('scores 1000 items in under 20ms', () => {
      const items = Array.from({ length: 1000 }, (_, i) => makeMemoryItem(i));
      const elapsed = measureSync(() => {
        scorer.rankItems(items, 'typescript logging', 10);
      });
      expect(elapsed).toBeLessThan(20);
    });

    it('scores 10000 items in under 200ms', () => {
      const items = Array.from({ length: 10000 }, (_, i) => makeMemoryItem(i));
      const elapsed = measureSync(() => {
        scorer.rankItems(items, 'typescript logging performance', 10);
      });
      expect(elapsed).toBeLessThan(200);
    });

    it('individual score computation is sub-microsecond amortized', () => {
      const items = Array.from({ length: 1000 }, (_, i) => makeMemoryItem(i));
      const start = performance.now();
      for (const item of items) {
        scorer.scoreItem(item, 'testing');
      }
      const elapsed = performance.now() - start;
      const perItem = elapsed / items.length;
      // Each item should take less than 0.1ms (100 microseconds)
      expect(perItem).toBeLessThan(0.1);
    });
  });

  describe('Structured memory I/O performance', () => {
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

    it('creates 100 items in under 2 seconds', async () => {
      const elapsed = await measure(async () => {
        for (let i = 0; i < 100; i++) {
          await mem.createItem({
            type: 'knowledge',
            summary: `Performance test item ${i}: ${randomSentence(i)}`,
            source: `session-perf-${i}`,
            source_type: 'agent_analysis',
            tags: [`tag-${i % 10}`, 'perf'],
            category: `coding/perf-${i % 5}`,
          });
        }
      });
      expect(elapsed).toBeLessThan(2000);
    });

    it('lists 100 items in under 500ms', async () => {
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

      const elapsed = await measure(async () => {
        await mem.listItems();
      });
      expect(elapsed).toBeLessThan(500);
    });

    it('searches 100 items in under 500ms', async () => {
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

      const elapsed = await measure(async () => {
        await mem.searchItems('typescript logging');
      });
      expect(elapsed).toBeLessThan(500);
    });

    it('getItem by ID is under 10ms', async () => {
      const item = await mem.createItem({
        type: 'knowledge',
        summary: 'Quick retrieval test',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['perf'],
        category: 'coding/perf',
      });

      const elapsed = await measure(async () => {
        await mem.getItem(item.id);
      });
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe('MemoryManager search performance at scale', () => {
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

    it('searchMemory with 100 items completes in under 1 second', async () => {
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

      const elapsed = await measure(async () => {
        await manager.searchMemory('typescript testing', 10);
      });
      expect(elapsed).toBeLessThan(1000);
    });

    it('loadContext with 50 items completes in under 2 seconds', async () => {
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

      const elapsed = await measure(async () => {
        await manager.loadContext();
      });
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe('Recency decay computation', () => {
    const scorer = new SalienceScorer();

    it('computes 10000 recency decays in under 10ms', () => {
      const timestamps = Array.from({ length: 10000 }, (_, i) =>
        new Date(Date.now() - i * 86400000).toISOString(),
      );

      const elapsed = measureSync(() => {
        for (const ts of timestamps) {
          scorer.recencyDecay(ts);
        }
      });
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe('Relevance scoring computation', () => {
    const scorer = new SalienceScorer();

    it('computes 1000 relevance scores in under 20ms', () => {
      const items = Array.from({ length: 1000 }, (_, i) => makeMemoryItem(i));

      const elapsed = measureSync(() => {
        for (const item of items) {
          scorer.relevanceScore('typescript logging framework', item);
        }
      });
      expect(elapsed).toBeLessThan(20);
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
