/**
 * MEM-14: E2E persistence tests.
 *
 * Tests the full lifecycle:
 *   - Save memory item -> destroy manager -> create new manager -> search -> find
 *   - Daily notes persist across restarts
 *   - MEMORY.md is read but never written by agent tools
 *   - Index rebuilds from JSON files on cold start
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import { StructuredMemory } from '../../../src/memory/structured-memory.js';
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
    context_days: 7,
    max_context_items: 10,
    max_category_summaries: 5,
    auto_extract_interval: 3600,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('E2E Persistence — MEM-14', () => {
  let baseDir: string;
  let config: MemoryConfig;

  beforeEach(async () => {
    baseDir = path.join(os.tmpdir(), `zora-e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    config = makeConfig();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  describe('Save -> destroy -> create new -> find', () => {
    it('structured memory items survive manager restart', async () => {
      // Session 1: Create items
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      const item1 = await manager1.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Zora uses pino for structured logging',
        source: 'session-1',
        source_type: 'user_instruction',
        tags: ['zora', 'logging', 'pino'],
        category: 'coding/zora',
      });

      const item2 = await manager1.structuredMemory.createItem({
        type: 'behavior',
        summary: 'Always run tests before committing code',
        source: 'session-1',
        source_type: 'user_instruction',
        tags: ['testing', 'workflow'],
        category: 'personal/workflow',
      });

      // "Destroy" manager1 (let it go out of scope)
      const savedId1 = item1.id;
      const savedId2 = item2.id;

      // Session 2: New manager, same baseDir
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      // Find items by ID
      const found1 = await manager2.structuredMemory.getItem(savedId1);
      expect(found1).not.toBeNull();
      expect(found1!.summary).toBe('Zora uses pino for structured logging');
      expect(found1!.type).toBe('knowledge');
      expect(found1!.tags).toEqual(['zora', 'logging', 'pino']);

      const found2 = await manager2.structuredMemory.getItem(savedId2);
      expect(found2).not.toBeNull();
      expect(found2!.summary).toBe('Always run tests before committing code');
    });

    it('items are searchable after restart', async () => {
      // Session 1: Create items
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      await manager1.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'TypeScript strict mode is essential for type safety',
        source: 'session-1',
        source_type: 'agent_analysis',
        tags: ['typescript', 'strict'],
        category: 'coding/typescript',
      });

      // Session 2: New manager
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const results = await manager2.searchMemory('typescript');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const match = results.find(r => r.score > 0);
      expect(match).toBeDefined();
    });

    it('context loading works after restart', async () => {
      // Session 1
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      await manager1.structuredMemory.createItem({
        type: 'skill',
        summary: 'Use git worktrees for parallel agent work',
        source: 'session-1',
        source_type: 'user_instruction',
        tags: ['git', 'workflow'],
        category: 'coding/git',
      });

      // Session 2
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const context = await manager2.loadContext();
      expect(context.some(c => c.includes('git worktrees'))).toBe(true);
    });
  });

  describe('Daily notes persist across restarts', () => {
    it('daily notes from previous session are readable', async () => {
      // Session 1: Write daily notes
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();
      await manager1.appendDailyNote('Fixed SSE parsing bug');
      await manager1.appendDailyNote('Merged PRs #105-#108');

      // Session 2: Read daily notes
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const context = await manager2.loadContext(1);
      const recentSection = context.find(c => c.includes('[RECENT CONTEXT]'));
      expect(recentSection).toBeDefined();
      expect(recentSection).toContain('Fixed SSE parsing bug');
      expect(recentSection).toContain('Merged PRs #105-#108');
    });

    it('appending to existing daily notes works across sessions', async () => {
      // Session 1
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();
      await manager1.appendDailyNote('Session 1 note');

      // Session 2
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();
      await manager2.appendDailyNote('Session 2 note');

      // Session 3: Verify both notes exist
      const manager3 = new MemoryManager(config, baseDir);
      await manager3.init();

      const context = await manager3.loadContext(1);
      const recentSection = context.find(c => c.includes('[RECENT CONTEXT]'));
      expect(recentSection).toBeDefined();
      expect(recentSection).toContain('Session 1 note');
      expect(recentSection).toContain('Session 2 note');
    });

    it('multiple days of notes are sorted correctly', async () => {
      const dailyDir = path.join(baseDir, config.daily_notes_dir);
      await fs.mkdir(dailyDir, { recursive: true, mode: 0o700 });

      // Write notes for 3 different days
      await fs.writeFile(path.join(dailyDir, '2026-02-12.md'), '# Feb 12\nOldest note');
      await fs.writeFile(path.join(dailyDir, '2026-02-13.md'), '# Feb 13\nMiddle note');
      await fs.writeFile(path.join(dailyDir, '2026-02-14.md'), '# Feb 14\nNewest note');

      const manager = new MemoryManager(config, baseDir);
      await manager.init();

      // Load 2 most recent days
      const context = await manager.loadContext(2);
      const recentSection = context.find(c => c.includes('[RECENT CONTEXT]'));
      expect(recentSection).toBeDefined();
      expect(recentSection).toContain('Feb 14');
      expect(recentSection).toContain('Feb 13');
      expect(recentSection).not.toContain('Feb 12');
    });
  });

  describe('MEMORY.md is read but never written by agent tools', () => {
    it('loadContext reads MEMORY.md content', async () => {
      const manager = new MemoryManager(config, baseDir);
      await manager.init();

      // Write custom MEMORY.md content
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.writeFile(ltPath, '# Persistent Facts\n\n- User prefers TypeScript\n- Always use strict mode\n');

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('User prefers TypeScript'))).toBe(true);
    });

    it('agent operations do not modify MEMORY.md', async () => {
      const manager = new MemoryManager(config, baseDir);
      await manager.init();

      const ltPath = path.join(baseDir, config.long_term_file);
      const originalContent = await fs.readFile(ltPath, 'utf8');

      // Perform various agent operations
      await manager.structuredMemory.createItem({
        type: 'knowledge', summary: 'New fact', source: 's',
        source_type: 'agent_analysis', tags: [], category: 'test/test',
      });
      await manager.searchMemory('anything');
      await manager.loadContext();
      await manager.appendDailyNote('Some daily note');

      // Verify MEMORY.md is unchanged
      const afterContent = await fs.readFile(ltPath, 'utf8');
      expect(afterContent).toBe(originalContent);
    });

    it('init does not overwrite existing MEMORY.md', async () => {
      // First init creates default
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      // Customize it
      const ltPath = path.join(baseDir, config.long_term_file);
      await fs.writeFile(ltPath, '# Custom Memory\n\n- Custom fact here\n');

      // Second init should NOT overwrite
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const content = await fs.readFile(ltPath, 'utf8');
      expect(content).toContain('Custom fact here');
      expect(content).not.toContain('No persistent memories yet');
    });
  });

  describe('Index rebuilds from JSON files on cold start', () => {
    it('items directory is the source of truth for structured memory', async () => {
      // Session 1: Create items
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      for (let i = 0; i < 5; i++) {
        await manager1.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Fact number ${i} about testing memory persistence`,
          source: 'session-1',
          source_type: 'agent_analysis',
          tags: ['testing', 'persistence'],
          category: 'coding/test',
        });
      }

      // Verify files exist on disk
      const itemsDir = path.join(baseDir, config.items_dir);
      const files = await fs.readdir(itemsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      expect(jsonFiles).toHaveLength(5);

      // Session 2: Cold start — new manager reads from disk
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const allItems = await manager2.structuredMemory.listItems();
      expect(allItems).toHaveLength(5);
    });

    it('search works immediately after cold start (no warm-up needed)', async () => {
      // Session 1
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      await manager1.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Docker containers isolate processes',
        source: 'session-1',
        source_type: 'agent_analysis',
        tags: ['docker', 'containers'],
        category: 'ops/docker',
      });

      // Session 2: Cold start + immediate search
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const results = await manager2.searchMemory('docker');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('deleted items are not recovered on restart', async () => {
      // Session 1: Create and delete
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      const item = await manager1.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Temporary fact to delete',
        source: 'session-1',
        source_type: 'tool_output',
        tags: ['temp'],
        category: 'general/temp',
      });
      await manager1.forgetItem(item.id);

      // Session 2: Cold start
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const found = await manager2.structuredMemory.getItem(item.id);
      expect(found).toBeNull();

      const allItems = await manager2.structuredMemory.listItems();
      expect(allItems.some(i => i.id === item.id)).toBe(false);
    });

    it('updated items reflect changes after restart', async () => {
      // Session 1: Create and update
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      const item = await manager1.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Original summary',
        source: 'session-1',
        source_type: 'agent_analysis',
        tags: ['original'],
        category: 'general/test',
      });
      await manager1.structuredMemory.updateItem(item.id, {
        summary: 'Updated summary after review',
        tags: ['updated', 'reviewed'],
      });

      // Session 2: Cold start
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const found = await manager2.structuredMemory.getItem(item.id);
      expect(found).not.toBeNull();
      expect(found!.summary).toBe('Updated summary after review');
      expect(found!.tags).toContain('updated');
    });
  });

  describe('Category summaries persist', () => {
    it('category summaries survive restart', async () => {
      // Session 1
      const manager1 = new MemoryManager(config, baseDir);
      await manager1.init();

      await manager1.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'TypeScript fact',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['typescript'],
        category: 'coding/typescript',
      });

      // Manually write a category summary file
      const catDir = path.join(baseDir, config.categories_dir);
      const catFile = path.join(catDir, 'coding--typescript.json');
      await fs.writeFile(catFile, JSON.stringify({
        category: 'coding/typescript',
        summary: '1 items about TypeScript',
        item_count: 1,
        last_updated: new Date().toISOString(),
        member_item_ids: ['test'],
      }));

      // Session 2
      const manager2 = new MemoryManager(config, baseDir);
      await manager2.init();

      const categories = await manager2.getCategories();
      expect(categories.length).toBeGreaterThanOrEqual(1);
      expect(categories.some(c => c.category === 'coding/typescript')).toBe(true);
    });
  });

  describe('Concurrent operations safety', () => {
    it('multiple rapid creates do not corrupt storage', async () => {
      const manager = new MemoryManager(config, baseDir);
      await manager.init();

      // Create 20 items in rapid succession
      const promises = Array.from({ length: 20 }, (_, i) =>
        manager.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Rapid creation test item ${i}`,
          source: 'session-concurrent',
          source_type: 'agent_analysis',
          tags: [`item-${i}`],
          category: 'test/concurrent',
        }),
      );

      const items = await Promise.all(promises);
      expect(items).toHaveLength(20);

      // All IDs should be unique
      const ids = new Set(items.map(i => i.id));
      expect(ids.size).toBe(20);

      // All should be recoverable
      const allItems = await manager.structuredMemory.listItems();
      expect(allItems).toHaveLength(20);
    });
  });
});
