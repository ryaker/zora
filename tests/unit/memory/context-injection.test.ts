/**
 * MEM-13: Context injection tests.
 *
 * Tests that the MemoryManager correctly assembles context from all 3 tiers
 * and that context injection behaves correctly for routine tasks,
 * retried tasks, and empty memory states.
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

  describe('loadContext assembles all tiers', () => {
    it('includes Tier 1 (MEMORY.md) in context', async () => {
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.writeFile(ltPath, '# Long-term Memory\n\n- User prefers TypeScript strict mode\n');

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[LONG-TERM MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('User prefers TypeScript strict mode'))).toBe(true);
    });

    it('includes Tier 2 (daily notes) in context', async () => {
      await manager.appendDailyNote('Fixed the SSE parsing bug today.');

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[RECENT CONTEXT]'))).toBe(true);
      expect(context.some(c => c.includes('Fixed the SSE parsing bug'))).toBe(true);
    });

    it('includes Tier 3 (structured items) in context', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Zora uses pino for logging',
        source: 'session-1',
        source_type: 'user_instruction',
        tags: ['zora', 'logging'],
        category: 'coding/zora',
      });

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[MEMORY ITEMS]'))).toBe(true);
      expect(context.some(c => c.includes('Zora uses pino for logging'))).toBe(true);
    });

    it('includes all 3 tiers when all are populated', async () => {
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
      expect(context.some(c => c.includes('[RECENT CONTEXT]'))).toBe(true);
      expect(context.some(c => c.includes('[MEMORY ITEMS]'))).toBe(true);
    });
  });

  describe('Empty memory does not break context loading', () => {
    it('returns context without errors when no MEMORY.md exists', async () => {
      // Delete the default MEMORY.md that init created
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.unlink(ltPath).catch(() => {});

      const context = await manager.loadContext();
      // Should not throw, and should not include LONG-TERM section
      expect(context.every(c => !c.includes('[LONG-TERM MEMORY]'))).toBe(true);
    });

    it('returns context without errors when no daily notes exist', async () => {
      const context = await manager.loadContext();
      // No daily notes written, so no RECENT CONTEXT section
      expect(Array.isArray(context)).toBe(true);
    });

    it('returns context without errors when no items exist', async () => {
      const context = await manager.loadContext();
      // No structured items, so no MEMORY ITEMS section
      expect(Array.isArray(context)).toBe(true);
    });

    it('returns empty array when everything is empty', async () => {
      // Remove the default MEMORY.md
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.unlink(ltPath).catch(() => {});

      const context = await manager.loadContext();
      expect(Array.isArray(context)).toBe(true);
      expect(context.length).toBe(0);
    });
  });

  describe('Context respects configuration limits', () => {
    it('respects context_days parameter', async () => {
      const dailyDir = path.join(baseDir, config.daily_notes_dir);

      // Create 5 daily note files
      for (let i = 10; i < 15; i++) {
        await fs.writeFile(
          path.join(dailyDir, `2026-02-${i}.md`),
          `# Day ${i}\nNote for day ${i}`,
        );
      }

      // Load with 2 days limit
      const context = await manager.loadContext(2);
      const recentSection = context.find(c => c.includes('[RECENT CONTEXT]'));
      if (recentSection) {
        // Should include the most recent 2 days
        expect(recentSection).toContain('2026-02-14');
        expect(recentSection).toContain('2026-02-13');
        // Should NOT include older days
        expect(recentSection).not.toContain('2026-02-10');
        expect(recentSection).not.toContain('2026-02-11');
      }
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

      const context = await manager.loadContext();
      const itemSection = context.find(c => c.includes('[MEMORY ITEMS]'));
      if (itemSection) {
        expect(itemSection).toContain('salience:');
      }
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

      // First load
      const context1 = await manager.loadContext();
      expect(context1.length).toBeGreaterThan(0);

      // Second load (simulating a retry or next task)
      const context2 = await manager.loadContext();
      expect(context2.length).toBeGreaterThan(0);

      // Both should contain the item
      expect(context1.some(c => c.includes('Fact for routine task'))).toBe(true);
      expect(context2.some(c => c.includes('Fact for routine task'))).toBe(true);
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

      // Simulate multiple retries of the same task
      const results: string[][] = [];
      for (let i = 0; i < 3; i++) {
        results.push(await manager.loadContext());
      }

      // All should find the item
      for (const ctx of results) {
        expect(ctx.some(c => c.includes('exponential backoff'))).toBe(true);
      }
    });
  });

  describe('Daily notes append correctly', () => {
    it('appends multiple notes to the same day', async () => {
      await manager.appendDailyNote('First note');
      await manager.appendDailyNote('Second note');
      await manager.appendDailyNote('Third note');

      const context = await manager.loadContext(1);
      const recentSection = context.find(c => c.includes('[RECENT CONTEXT]'));
      expect(recentSection).toBeDefined();
      expect(recentSection).toContain('First note');
      expect(recentSection).toContain('Second note');
      expect(recentSection).toContain('Third note');
    });

    it('daily note file is created if it does not exist', async () => {
      // The daily dir exists from init, but no file for today
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
      // The logging item should appear with a score
      expect(results[0]!.score).toBeGreaterThan(0);
      // Results should be sorted in descending order by score
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
