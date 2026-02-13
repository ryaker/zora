import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StructuredMemory } from '../../../src/memory/structured-memory.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('StructuredMemory', () => {
  let itemsDir: string;
  let mem: StructuredMemory;

  beforeEach(async () => {
    itemsDir = path.join(os.tmpdir(), `zora-sm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mem = new StructuredMemory(itemsDir);
    await mem.init();
  });

  afterEach(async () => {
    await fs.rm(itemsDir, { recursive: true, force: true });
  });

  it('creates items directory on init', async () => {
    const stats = await fs.stat(itemsDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('creates an item with generated ID and defaults', async () => {
    const item = await mem.createItem({
      type: 'knowledge',
      summary: 'TypeScript supports generics',
      source: 'session-1',
      source_type: 'agent_analysis',
      tags: ['typescript', 'generics'],
      category: 'coding/typescript',
    });

    expect(item.id).toMatch(/^mem_\d+_[a-f0-9]+$/);
    expect(item.access_count).toBe(0);
    expect(item.reinforcement_score).toBe(0);
    expect(item.created_at).toBeTruthy();
    expect(item.last_accessed).toBeTruthy();
  });

  it('reads an item and increments access count', async () => {
    const created = await mem.createItem({
      type: 'profile',
      summary: 'User prefers dark mode',
      source: 'session-2',
      source_type: 'user_instruction',
      tags: ['preferences'],
      category: 'personal/preferences',
    });

    const fetched = await mem.getItem(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.access_count).toBe(1);
    expect(fetched!.summary).toBe('User prefers dark mode');

    const fetched2 = await mem.getItem(created.id);
    expect(fetched2!.access_count).toBe(2);
  });

  it('returns null for nonexistent item', async () => {
    const result = await mem.getItem('mem_000_nonexistent');
    expect(result).toBeNull();
  });

  it('updates an item', async () => {
    const created = await mem.createItem({
      type: 'event',
      summary: 'Deployed v1.0',
      source: 'session-3',
      source_type: 'tool_output',
      tags: ['deployment'],
      category: 'events/deployment',
    });

    const updated = await mem.updateItem(created.id, {
      summary: 'Deployed v1.0 to production',
      tags: ['deployment', 'production'],
    });

    expect(updated).not.toBeNull();
    expect(updated!.summary).toBe('Deployed v1.0 to production');
    expect(updated!.tags).toContain('production');
    expect(updated!.id).toBe(created.id); // ID is immutable
  });

  it('returns null when updating nonexistent item', async () => {
    const result = await mem.updateItem('mem_000_nope', { summary: 'nope' });
    expect(result).toBeNull();
  });

  it('deletes an item', async () => {
    const created = await mem.createItem({
      type: 'skill',
      summary: 'Can write vitest tests',
      source: 'session-4',
      source_type: 'agent_analysis',
      tags: ['testing'],
      category: 'coding/testing',
    });

    const deleted = await mem.deleteItem(created.id);
    expect(deleted).toBe(true);

    const fetched = await mem.getItem(created.id);
    expect(fetched).toBeNull();
  });

  it('returns false when deleting nonexistent item', async () => {
    const deleted = await mem.deleteItem('mem_000_gone');
    expect(deleted).toBe(false);
  });

  it('lists items with filters', async () => {
    await mem.createItem({ type: 'knowledge', summary: 'A', source: 's', source_type: 'agent_analysis', tags: ['a'], category: 'coding/a' });
    await mem.createItem({ type: 'profile', summary: 'B', source: 's', source_type: 'user_instruction', tags: ['b'], category: 'personal/b' });
    await mem.createItem({ type: 'knowledge', summary: 'C', source: 's', source_type: 'agent_analysis', tags: ['a', 'c'], category: 'coding/a' });

    const all = await mem.listItems();
    expect(all).toHaveLength(3);

    const knowledge = await mem.listItems({ type: 'knowledge' });
    expect(knowledge).toHaveLength(2);

    const byCat = await mem.listItems({ category: 'coding/a' });
    expect(byCat).toHaveLength(2);

    const byTag = await mem.listItems({ tags: ['a', 'c'] });
    expect(byTag).toHaveLength(1);
  });

  it('searches items by keyword', async () => {
    await mem.createItem({ type: 'knowledge', summary: 'TypeScript strict mode', source: 's', source_type: 'agent_analysis', tags: ['ts'], category: 'coding/ts' });
    await mem.createItem({ type: 'knowledge', summary: 'Python type hints', source: 's', source_type: 'agent_analysis', tags: ['python'], category: 'coding/py' });

    const results = await mem.searchItems('TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0]!.summary).toContain('TypeScript');

    const tagSearch = await mem.searchItems('python');
    expect(tagSearch).toHaveLength(1);
  });

  it('writes atomically using tmp files', async () => {
    const item = await mem.createItem({
      type: 'tool',
      summary: 'Atomic write test',
      source: 's',
      source_type: 'tool_output',
      tags: [],
      category: 'coding/test',
    });

    // Verify the final file exists and no .tmp remains
    const files = await fs.readdir(itemsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(jsonFiles).toHaveLength(1);
    expect(tmpFiles).toHaveLength(0);
    expect(jsonFiles[0]).toBe(`${item.id}.json`);
  });
});
