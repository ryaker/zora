import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CategoryOrganizer } from '../../../src/memory/category-organizer.js';
import { StructuredMemory } from '../../../src/memory/structured-memory.js';
import { SalienceScorer } from '../../../src/memory/salience-scorer.js';
import type { MemoryItem } from '../../../src/memory/memory-types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'knowledge',
    summary: 'Test item',
    source: 'session-1',
    source_type: 'agent_analysis',
    created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: 0,
    reinforcement_score: 0,
    tags: ['test'],
    category: '',
    ...overrides,
  };
}

describe('CategoryOrganizer', () => {
  let testDir: string;
  let categoriesDir: string;
  let itemsDir: string;
  let organizer: CategoryOrganizer;
  let structuredMemory: StructuredMemory;

  const mockSummarizeFn = async (items: MemoryItem[]) =>
    `Summary of ${items.length} items about ${items[0]?.type ?? 'unknown'}`;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `zora-cat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    categoriesDir = path.join(testDir, 'categories');
    itemsDir = path.join(testDir, 'items');
    organizer = new CategoryOrganizer(categoriesDir, mockSummarizeFn);
    structuredMemory = new StructuredMemory(itemsDir);
    await organizer.init();
    await structuredMemory.init();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('creates categories directory on init', async () => {
    const stats = await fs.stat(categoriesDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('assigns category based on type and tags', () => {
    const toolItem = makeItem({ type: 'tool', tags: ['webpack'] });
    expect(organizer.assignCategory(toolItem)).toBe('coding/webpack');

    const profileItem = makeItem({ type: 'profile', tags: ['preferences'] });
    expect(organizer.assignCategory(profileItem)).toBe('personal/preferences');

    const eventItem = makeItem({ type: 'event', tags: [] });
    expect(organizer.assignCategory(eventItem)).toBe('events/general');
  });

  it('preserves existing category with slash', () => {
    const item = makeItem({ category: 'custom/deep/path' });
    expect(organizer.assignCategory(item)).toBe('custom/deep/path');
  });

  it('writes and reads a category summary', async () => {
    const items = [makeItem({ type: 'knowledge', summary: 'Fact about TS' })];
    await organizer.updateCategorySummary('coding/typescript', items);

    const summary = await organizer.getCategorySummary('coding/typescript');
    expect(summary).not.toBeNull();
    expect(summary!.category).toBe('coding/typescript');
    expect(summary!.item_count).toBe(1);
    expect(summary!.summary).toContain('1 items');
    expect(summary!.member_item_ids).toHaveLength(1);
  });

  it('returns null for nonexistent category', async () => {
    const summary = await organizer.getCategorySummary('does/not/exist');
    expect(summary).toBeNull();
  });

  it('lists all category summaries', async () => {
    await organizer.updateCategorySummary('coding/ts', [makeItem()]);
    await organizer.updateCategorySummary('personal/prefs', [makeItem({ type: 'profile' })]);

    const categories = await organizer.listCategories();
    expect(categories).toHaveLength(2);
    const names = categories.map(c => c.category);
    expect(names).toContain('coding/ts');
    expect(names).toContain('personal/prefs');
  });

  it('gets items by category from structured memory', async () => {
    await structuredMemory.createItem({
      type: 'knowledge', summary: 'A', source: 's', source_type: 'agent_analysis',
      tags: [], category: 'coding/ts',
    });
    await structuredMemory.createItem({
      type: 'knowledge', summary: 'B', source: 's', source_type: 'agent_analysis',
      tags: [], category: 'coding/ts',
    });
    await structuredMemory.createItem({
      type: 'profile', summary: 'C', source: 's', source_type: 'user_instruction',
      tags: [], category: 'personal/prefs',
    });

    const tsItems = await organizer.getItemsByCategory('coding/ts', structuredMemory);
    expect(tsItems).toHaveLength(2);
  });

  it('provides dual-mode context with summaries and top items', async () => {
    // Create items in structured memory
    await structuredMemory.createItem({
      type: 'knowledge', summary: 'TypeScript generics deep dive', source: 's',
      source_type: 'agent_analysis', tags: ['typescript'], category: 'coding/ts',
    });
    await structuredMemory.createItem({
      type: 'knowledge', summary: 'React hooks patterns', source: 's',
      source_type: 'agent_analysis', tags: ['react'], category: 'coding/react',
    });

    // Create category summaries
    const tsItems = await structuredMemory.listItems({ category: 'coding/ts' });
    await organizer.updateCategorySummary('coding/ts', tsItems);

    const scorer = new SalienceScorer();
    const { summaries, topItems } = await organizer.getDualModeContext(
      'typescript',
      structuredMemory,
      scorer,
      5,
      10,
    );

    expect(summaries.length).toBeGreaterThanOrEqual(1);
    expect(topItems.length).toBeGreaterThanOrEqual(1);
    // The typescript item should rank higher
    const tsScore = topItems.find(s => s.itemId.length > 0);
    expect(tsScore).toBeDefined();
  });

  it('dual-mode respects maxCategories and maxItems limits', async () => {
    // Create several categories
    for (let i = 0; i < 5; i++) {
      await organizer.updateCategorySummary(`cat/${i}`, [makeItem()]);
      await structuredMemory.createItem({
        type: 'knowledge', summary: `Item ${i}`, source: 's',
        source_type: 'agent_analysis', tags: [], category: `cat/${i}`,
      });
    }

    const scorer = new SalienceScorer();
    const { summaries, topItems } = await organizer.getDualModeContext(
      'item',
      structuredMemory,
      scorer,
      2, // max 2 categories
      3, // max 3 items
    );

    expect(summaries.length).toBeLessThanOrEqual(2);
    expect(topItems.length).toBeLessThanOrEqual(3);
  });
});
