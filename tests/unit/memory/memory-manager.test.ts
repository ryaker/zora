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
});
