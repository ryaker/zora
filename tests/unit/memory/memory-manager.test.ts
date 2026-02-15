import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import type { MemoryConfig } from '../../../src/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('MemoryManager', () => {
  const testDir = path.join(os.tmpdir(), 'zora-memory-test');
  let manager: MemoryManager;

  const config: MemoryConfig = {
    long_term_file: 'memory/MEMORY.md',
    daily_notes_dir: 'memory/daily',
    items_dir: 'memory/items',
    categories_dir: 'memory/categories',
    context_days: 7,
    max_context_items: 50,
    max_category_summaries: 10,
    auto_extract_interval: 3600,
    auto_extract: true,
  };

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    manager = new MemoryManager(config, testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('initializes memory structure', async () => {
    await manager.init();
    
    const ltPath = path.join(testDir, config.long_term_file);
    const dnDir = path.join(testDir, config.daily_notes_dir);
    
    await expect(fs.access(ltPath)).resolves.toBeUndefined();
    const stats = await fs.stat(dnDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('appends and reads daily notes', async () => {
    await manager.init();
    await manager.appendDailyNote('User learned about WSJF.');
    
    const context = await manager.loadContext(1);
    expect(context.some(c => c.includes('User learned about WSJF'))).toBe(true);
    expect(context.some(c => c.includes('[RECENT CONTEXT]'))).toBe(true);
  });

  it('reads long-term memory', async () => {
    await manager.init();
    const ltPath = path.join(testDir, config.long_term_file);
    await fs.writeFile(ltPath, `# Permanent Memory
- Key: value`);

    const context = await manager.loadContext();
    expect(context.some(c => c.includes('Permanent Memory'))).toBe(true);
    expect(context.some(c => c.includes('[LONG-TERM MEMORY]'))).toBe(true);
  });

  it('respects rolling context window (days)', async () => {
    await manager.init();
    const dnDir = path.join(testDir, config.daily_notes_dir);

    // Create notes for 3 different days
    await fs.writeFile(path.join(dnDir, '2026-02-10.md'), 'Day 10');
    await fs.writeFile(path.join(dnDir, '2026-02-11.md'), 'Day 11');
    await fs.writeFile(path.join(dnDir, '2026-02-12.md'), 'Day 12');

    // Limit to last 2 days
    const context = await manager.loadContext(2);
    expect(context.some(c => c.includes('2026-02-12'))).toBe(true);
    expect(context.some(c => c.includes('2026-02-11'))).toBe(true);
    expect(context.some(c => c.includes('2026-02-10'))).toBe(false);
  });

  // ── Tier 3 integration tests ──────────────────────────────────

  it('initializes Tier 3 directories (items + categories)', async () => {
    await manager.init();
    const itemsDir = path.join(testDir, config.items_dir);
    const catsDir = path.join(testDir, config.categories_dir);

    const itemsStats = await fs.stat(itemsDir);
    expect(itemsStats.isDirectory()).toBe(true);

    const catsStats = await fs.stat(catsDir);
    expect(catsStats.isDirectory()).toBe(true);
  });

  it('searchMemory returns salience-ranked results', async () => {
    await manager.init();
    const sm = manager.structuredMemory;

    await sm.createItem({
      type: 'knowledge', summary: 'TypeScript strict mode benefits',
      source: 's', source_type: 'user_instruction', tags: ['typescript'], category: 'coding/ts',
    });
    await sm.createItem({
      type: 'knowledge', summary: 'Python list comprehensions',
      source: 's', source_type: 'agent_analysis', tags: ['python'], category: 'coding/py',
    });

    const results = await manager.searchMemory('typescript');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // TypeScript item should be top-ranked
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('forgetItem removes a structured memory item', async () => {
    await manager.init();
    const sm = manager.structuredMemory;

    const item = await sm.createItem({
      type: 'event', summary: 'Temp event',
      source: 's', source_type: 'tool_output', tags: [], category: 'events/tmp',
    });

    const deleted = await manager.forgetItem(item.id);
    expect(deleted).toBe(true);

    const gone = await sm.getItem(item.id);
    expect(gone).toBeNull();
  });

  it('getCategories returns category summaries', async () => {
    await manager.init();

    // Initially empty
    const empty = await manager.getCategories();
    expect(empty).toHaveLength(0);
  });

  it('loadContext includes Tier 3 memory items', async () => {
    await manager.init();
    const sm = manager.structuredMemory;

    await sm.createItem({
      type: 'knowledge', summary: 'Important fact about Zora architecture',
      source: 's', source_type: 'user_instruction', tags: ['architecture'], category: 'coding/zora',
    });

    const context = await manager.loadContext(1);
    // Should include memory items section
    expect(context.some(c => c.includes('[MEMORY ITEMS]'))).toBe(true);
    expect(context.some(c => c.includes('Important fact about Zora architecture'))).toBe(true);
  });
});
