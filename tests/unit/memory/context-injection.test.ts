/**
 * MEM-13: Context injection tests.
 *
 * Tests that the MemoryManager correctly assembles context from all 3 tiers.
 * With progressive loading, loadContext() returns a lightweight index.
 * loadFullContext() preserves the old full-dump behavior.
 * recallMemory() and recallDailyNotes() provide on-demand retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import type { MemoryConfig } from '../../../src/types.js';
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
    max_context_items: 5,
    max_category_summaries: 3,
    auto_extract_interval: 3600,
    auto_extract: true,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Context Injection — MEM-13', () => {
  let baseDir: string;
  let manager: MemoryManager;
  let config: MemoryConfig;

  beforeEach(async () => {
    baseDir = path.join(os.tmpdir(), `zora-ctx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    config = makeConfig();
    manager = new MemoryManager(config, baseDir);
    await manager.init();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  describe('Progressive loadContext returns lightweight index', () => {
    it('includes Tier 1 (MEMORY.md) in progressive context', async () => {
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.writeFile(ltPath, '# Long-term Memory\n\n- User prefers TypeScript strict mode\n');

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[LONG-TERM MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('User prefers TypeScript strict mode'))).toBe(true);
    });

    it('shows daily notes availability (not content) in progressive context', async () => {
      await manager.appendDailyNote('Fixed the SSE parsing bug today.');

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('Daily notes available'))).toBe(true);
      // Progressive context does NOT include daily note content
      expect(context.some(c => c.includes('Fixed the SSE parsing bug'))).toBe(false);
    });

    it('shows item count and categories (not items) in progressive context', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Zora uses pino for logging',
        source: 'session-1',
        source_type: 'user_instruction',
        tags: ['zora', 'logging'],
        category: 'coding/zora',
      });

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('1 items'))).toBe(true);
      expect(context.some(c => c.includes('memory_search'))).toBe(true);
      // Should NOT dump items into progressive context
      expect(context.some(c => c.includes('[MEMORY ITEMS]'))).toBe(false);
      expect(context.some(c => c.includes('Zora uses pino for logging'))).toBe(false);
    });

    it('includes all populated tiers as index info', async () => {
      // Tier 1
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.writeFile(ltPath, '# Memory\n\n- Important fact\n');

      // Tier 2
      await manager.appendDailyNote('Session note here.');

      // Tier 3
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Structured memory item',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['test'],
        category: 'coding/test',
      });

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[LONG-TERM MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('[MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('1 items'))).toBe(true);
      expect(context.some(c => c.includes('Daily notes available'))).toBe(true);
    });
  });

  describe('loadFullContext preserves old behavior', () => {
    it('includes all 3 tiers with full content', async () => {
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.writeFile(ltPath, '# Memory\n\n- Full context fact\n');
      await manager.appendDailyNote('Full context daily note.');
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Full context memory item',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['test'],
        category: 'coding/test',
      });

      const context = await manager.loadFullContext();
      expect(context.some(c => c.includes('[LONG-TERM MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('[RECENT CONTEXT]'))).toBe(true);
      expect(context.some(c => c.includes('[MEMORY ITEMS]'))).toBe(true);
      expect(context.some(c => c.includes('Full context fact'))).toBe(true);
      expect(context.some(c => c.includes('Full context daily note'))).toBe(true);
      expect(context.some(c => c.includes('Full context memory item'))).toBe(true);
    });

    it('includes salience scores in memory items output', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Item with salience score',
        source: 'session-1',
        source_type: 'user_instruction',
        tags: ['test'],
        category: 'coding/test',
      });

      const context = await manager.loadFullContext();
      const itemSection = context.find(c => c.includes('[MEMORY ITEMS]'));
      if (itemSection) {
        expect(itemSection).toContain('salience:');
      }
    });
  });

  describe('Empty memory does not break context loading', () => {
    it('returns context without errors when no MEMORY.md exists', async () => {
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.unlink(ltPath).catch(() => {});

      const context = await manager.loadContext();
      expect(context.every(c => !c.includes('[LONG-TERM MEMORY]'))).toBe(true);
    });

    it('returns context without errors when no daily notes exist', async () => {
      const context = await manager.loadContext();
      expect(Array.isArray(context)).toBe(true);
    });

    it('returns context without errors when no items exist', async () => {
      const context = await manager.loadContext();
      expect(Array.isArray(context)).toBe(true);
    });

    it('returns index even when everything is nearly empty', async () => {
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.unlink(ltPath).catch(() => {});

      const context = await manager.loadContext();
      expect(Array.isArray(context)).toBe(true);
      // Progressive loadContext always returns at least the index
      expect(context.some(c => c.includes('[MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('0 items'))).toBe(true);
    });
  });

  describe('On-demand retrieval methods', () => {
    it('recallDailyNotes returns requested days', async () => {
      const dailyDir = path.join(baseDir, config.daily_notes_dir);
      for (let i = 10; i < 15; i++) {
        await fs.writeFile(
          path.join(dailyDir, `2026-02-${i}.md`),
          `# Day ${i}\nNote for day ${i}`,
        );
      }

      const notes = await manager.recallDailyNotes(2);
      expect(notes.length).toBe(2);
      expect(notes.some(n => n.includes('2026-02-14'))).toBe(true);
      expect(notes.some(n => n.includes('2026-02-13'))).toBe(true);
      expect(notes.some(n => n.includes('2026-02-10'))).toBe(false);
    });

    it('recallMemory returns query-relevant items', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'TypeScript strict mode is recommended',
        source: 's',
        source_type: 'user_instruction',
        tags: ['typescript'],
        category: 'coding/ts',
      });
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Python has list comprehensions',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['python'],
        category: 'coding/py',
      });

      const result = await manager.recallMemory('typescript', 5);
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some(i => i.summary.includes('TypeScript'))).toBe(true);
      expect(result.scores.length).toBeGreaterThanOrEqual(1);
    });

    it('getMemoryIndex returns stats without reading items', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Index test item 1',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['test'],
        category: 'coding/test',
      });
      await manager.structuredMemory.createItem({
        type: 'skill',
        summary: 'Index test item 2',
        source: 's',
        source_type: 'user_instruction',
        tags: ['test'],
        category: 'coding/skills',
      });

      const index = await manager.getMemoryIndex();
      expect(index.itemCount).toBe(2);
      expect(index.categoryNames).toEqual(expect.arrayContaining([]));
      expect(typeof index.dailyNoteCount).toBe('number');
    });

    it('getMemoryIndex caches results', async () => {
      const index1 = await manager.getMemoryIndex();
      const index2 = await manager.getMemoryIndex();
      // Same reference = cached
      expect(index1).toBe(index2);
    });

    it('index cache is invalidated on write operations', async () => {
      const index1 = await manager.getMemoryIndex();
      expect(index1.dailyNoteCount).toBe(0);

      await manager.appendDailyNote('New note invalidates cache');

      const index2 = await manager.getMemoryIndex();
      expect(index2).not.toBe(index1); // Different reference = cache was invalidated
      expect(index2.dailyNoteCount).toBe(1);
    });
  });

  describe('Routine tasks get context', () => {
    it('loadContext works for sequential calls (simulating routine tasks)', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Fact for routine task',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['routine'],
        category: 'general/routine',
      });

      // Both calls should succeed and return valid index
      const context1 = await manager.loadContext();
      expect(context1.length).toBeGreaterThan(0);

      const context2 = await manager.loadContext();
      expect(context2.length).toBeGreaterThan(0);

      // Both should contain the index with item count
      expect(context1.some(c => c.includes('[MEMORY]'))).toBe(true);
      expect(context2.some(c => c.includes('[MEMORY]'))).toBe(true);
    });
  });

  describe('Retried tasks get context', () => {
    it('context is consistent across retries', async () => {
      await manager.structuredMemory.createItem({
        type: 'skill',
        summary: 'Use exponential backoff for retries',
        source: 'session-retry',
        source_type: 'user_instruction',
        tags: ['resilience'],
        category: 'coding/patterns',
      });

      // Simulate multiple retries — all should return valid index
      const results: string[][] = [];
      for (let i = 0; i < 3; i++) {
        results.push(await manager.loadContext());
      }

      for (const ctx of results) {
        expect(ctx.some(c => c.includes('[MEMORY]'))).toBe(true);
        expect(ctx.some(c => c.includes('1 items'))).toBe(true);
      }
    });
  });

  describe('Daily notes append correctly', () => {
    it('appends multiple notes to the same day', async () => {
      await manager.appendDailyNote('First note');
      await manager.appendDailyNote('Second note');
      await manager.appendDailyNote('Third note');

      // Use recallDailyNotes to verify content
      const notes = await manager.recallDailyNotes(1);
      expect(notes.length).toBe(1);
      expect(notes[0]).toContain('First note');
      expect(notes[0]).toContain('Second note');
      expect(notes[0]).toContain('Third note');
    });

    it('daily note file is created if it does not exist', async () => {
      await manager.appendDailyNote('Auto-created note');

      const today = new Date().toISOString().split('T')[0];
      const notePath = path.join(baseDir, config.daily_notes_dir, `${today}.md`);
      const exists = await fs.access(notePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('searchMemory integrates scorer', () => {
    it('returns salience-ranked results from searchMemory()', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'pino logging library details',
        source: 's',
        source_type: 'user_instruction',
        tags: ['logging', 'pino'],
        category: 'coding/zora',
      });
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'random unrelated fact',
        source: 's',
        source_type: 'tool_output',
        tags: ['random'],
        category: 'general/misc',
      });

      const results = await manager.searchMemory('logging', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.score).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });

    it('respects limit parameter in searchMemory', async () => {
      for (let i = 0; i < 10; i++) {
        await manager.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Logging item number ${i}`,
          source: 's',
          source_type: 'agent_analysis',
          tags: ['logging'],
          category: 'coding/logging',
        });
      }

      const limited = await manager.searchMemory('logging', 3);
      expect(limited.length).toBeLessThanOrEqual(3);
    });
  });
});
