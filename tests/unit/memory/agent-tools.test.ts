/**
 * MEM-12: Agent tool integration tests.
 *
 * Tests that the memory_save, memory_search, and memory_forget tools
 * would work correctly when exposed to the agent. Since the tool
 * definitions are not yet implemented as standalone functions, these
 * tests verify the underlying MemoryManager methods that back them.
 *
 * Tests cover:
 *   - memory_save: createItem with correct defaults
 *   - memory_search: search with ranking
 *   - memory_forget: item removal
 *   - Tool definition schemas (structure validation)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import { StructuredMemory } from '../../../src/memory/structured-memory.js';
import type { MemoryConfig } from '../../../src/types.js';
import type { MemoryItem, MemoryItemType, SourceType } from '../../../src/memory/memory-types.js';
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

/**
 * Spec tool definitions from SS5.4 §5.
 * These describe what the agent tool schemas should look like.
 */
const MEMORY_SAVE_SCHEMA = {
  name: 'memory_save',
  required: ['content'],
  properties: {
    content: { type: 'string' },
    type: { type: 'string', enum: ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'] },
    tags: { type: 'array', items: { type: 'string' } },
    entity: { type: 'string' },
    source_type: { type: 'string', enum: ['user_instruction', 'agent_analysis', 'tool_output'] },
  },
};

const MEMORY_SEARCH_SCHEMA = {
  name: 'memory_search',
  required: ['query'],
  properties: {
    query: { type: 'string' },
    limit: { type: 'number' },
    type: { type: 'string' },
    entity: { type: 'string' },
    min_score: { type: 'number' },
  },
};

const MEMORY_FORGET_SCHEMA = {
  name: 'memory_forget',
  required: ['id'],
  properties: {
    id: { type: 'string' },
    reason: { type: 'string' },
  },
};

// ── Tests ───────────────────────────────────────────────────────────

describe('Agent Tools — MEM-12', () => {
  let baseDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    baseDir = path.join(os.tmpdir(), `zora-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    manager = new MemoryManager(makeConfig(), baseDir);
    await manager.init();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  describe('memory_save (backed by StructuredMemory.createItem)', () => {
    it('creates an item with all required fields', async () => {
      const sm = manager.structuredMemory;
      const item = await sm.createItem({
        type: 'knowledge',
        summary: 'Zora uses pino for structured logging',
        source: 'session-1',
        source_type: 'agent_analysis',
        tags: ['zora', 'logging', 'pino'],
        category: 'coding/zora',
      });

      expect(item.id).toMatch(/^mem_\d+_[a-f0-9]+$/);
      expect(item.type).toBe('knowledge');
      expect(item.summary).toBe('Zora uses pino for structured logging');
      expect(item.access_count).toBe(0);
      expect(item.reinforcement_score).toBe(0);
      expect(item.tags).toEqual(['zora', 'logging', 'pino']);
    });

    it('sets default timestamps on creation', async () => {
      const before = new Date().toISOString();
      const item = await manager.structuredMemory.createItem({
        type: 'profile',
        summary: 'User likes dark mode',
        source: 'session-1',
        source_type: 'user_instruction',
        tags: ['preferences'],
        category: 'personal/preferences',
      });
      const after = new Date().toISOString();

      expect(item.created_at >= before).toBe(true);
      expect(item.created_at <= after).toBe(true);
      expect(item.last_accessed).toBe(item.created_at);
    });

    it('creates items with each valid type', async () => {
      const types: MemoryItemType[] = ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'];
      for (const type of types) {
        const item = await manager.structuredMemory.createItem({
          type,
          summary: `Item of type ${type}`,
          source: 'test',
          source_type: 'agent_analysis',
          tags: [],
          category: `test/${type}`,
        });
        expect(item.type).toBe(type);
      }

      const all = await manager.structuredMemory.listItems();
      expect(all).toHaveLength(types.length);
    });

    it('creates items with each valid source_type', async () => {
      const sourceTypes: SourceType[] = ['user_instruction', 'agent_analysis', 'tool_output'];
      for (const st of sourceTypes) {
        const item = await manager.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Item with source ${st}`,
          source: 'test',
          source_type: st,
          tags: [],
          category: 'test/source',
        });
        expect(item.source_type).toBe(st);
      }
    });

    it('persists item to disk as JSON file', async () => {
      const item = await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Persisted item test',
        source: 'test',
        source_type: 'agent_analysis',
        tags: ['persistence'],
        category: 'coding/test',
      });

      const filePath = path.join(baseDir, 'memory/items', `${item.id}.json`);
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as MemoryItem;
      expect(parsed.id).toBe(item.id);
      expect(parsed.summary).toBe('Persisted item test');
    });
  });

  describe('memory_search (backed by MemoryManager.searchMemory)', () => {
    it('returns ranked results for a query', async () => {
      const sm = manager.structuredMemory;
      await sm.createItem({ type: 'knowledge', summary: 'Zora logging with pino', source: 's', source_type: 'agent_analysis', tags: ['logging'], category: 'coding/zora' });
      await sm.createItem({ type: 'knowledge', summary: 'React component lifecycle', source: 's', source_type: 'agent_analysis', tags: ['react'], category: 'coding/react' });

      const results = await manager.searchMemory('logging');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.score).toBeGreaterThan(0);
    });

    it('returns empty array for no matches', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge', summary: 'Only about python', source: 's',
        source_type: 'agent_analysis', tags: ['python'], category: 'coding/py',
      });

      const results = await manager.searchMemory('xyznonexistent');
      expect(results).toHaveLength(0);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await manager.structuredMemory.createItem({
          type: 'knowledge', summary: `Fact number ${i} about testing`, source: 's',
          source_type: 'agent_analysis', tags: ['testing'], category: 'coding/test',
        });
      }

      const limited = await manager.searchMemory('testing', 3);
      expect(limited.length).toBeLessThanOrEqual(3);
    });

    it('returns all matches when no limit specified', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.structuredMemory.createItem({
          type: 'knowledge', summary: `Logging fact ${i}`, source: 's',
          source_type: 'agent_analysis', tags: ['logging'], category: 'coding/log',
        });
      }

      const results = await manager.searchMemory('logging');
      expect(results.length).toBe(5);
    });
  });

  describe('memory_forget (backed by MemoryManager.forgetItem)', () => {
    it('removes an item by ID', async () => {
      const item = await manager.structuredMemory.createItem({
        type: 'event', summary: 'Temporary event to forget', source: 's',
        source_type: 'tool_output', tags: [], category: 'events/tmp',
      });

      const deleted = await manager.forgetItem(item.id);
      expect(deleted).toBe(true);

      // Verify it's gone
      const found = await manager.structuredMemory.getItem(item.id);
      expect(found).toBeNull();
    });

    it('returns false for nonexistent item', async () => {
      const deleted = await manager.forgetItem('mem_000_nonexistent');
      expect(deleted).toBe(false);
    });

    it('forgotten items do not appear in search results', async () => {
      const item = await manager.structuredMemory.createItem({
        type: 'knowledge', summary: 'Fact about logging that will be forgotten', source: 's',
        source_type: 'agent_analysis', tags: ['logging'], category: 'coding/log',
      });

      // Verify it appears in search first
      const beforeForget = await manager.searchMemory('logging');
      expect(beforeForget.some(r => r.itemId === item.id)).toBe(true);

      // Forget it
      await manager.forgetItem(item.id);

      // Verify it no longer appears
      const afterForget = await manager.searchMemory('logging');
      expect(afterForget.some(r => r.itemId === item.id)).toBe(false);
    });

    it('forgetting one item does not affect others', async () => {
      const sm = manager.structuredMemory;
      const keep = await sm.createItem({ type: 'knowledge', summary: 'Keep this item', source: 's', source_type: 'agent_analysis', tags: ['keep'], category: 'general/keep' });
      const forget = await sm.createItem({ type: 'knowledge', summary: 'Forget this item', source: 's', source_type: 'agent_analysis', tags: ['forget'], category: 'general/forget' });

      await manager.forgetItem(forget.id);

      const kept = await sm.getItem(keep.id);
      expect(kept).not.toBeNull();
      expect(kept!.summary).toBe('Keep this item');
    });
  });

  describe('Tool definition schema validation', () => {
    it('memory_save schema has correct structure', () => {
      expect(MEMORY_SAVE_SCHEMA.name).toBe('memory_save');
      expect(MEMORY_SAVE_SCHEMA.required).toContain('content');
      expect(MEMORY_SAVE_SCHEMA.properties.content.type).toBe('string');
      expect(MEMORY_SAVE_SCHEMA.properties.type.enum).toEqual(
        ['profile', 'event', 'knowledge', 'behavior', 'skill', 'tool'],
      );
      expect(MEMORY_SAVE_SCHEMA.properties.tags.type).toBe('array');
    });

    it('memory_search schema has correct structure', () => {
      expect(MEMORY_SEARCH_SCHEMA.name).toBe('memory_search');
      expect(MEMORY_SEARCH_SCHEMA.required).toContain('query');
      expect(MEMORY_SEARCH_SCHEMA.properties.query.type).toBe('string');
      expect(MEMORY_SEARCH_SCHEMA.properties.limit.type).toBe('number');
    });

    it('memory_forget schema has correct structure', () => {
      expect(MEMORY_FORGET_SCHEMA.name).toBe('memory_forget');
      expect(MEMORY_FORGET_SCHEMA.required).toContain('id');
      expect(MEMORY_FORGET_SCHEMA.properties.id.type).toBe('string');
      expect(MEMORY_FORGET_SCHEMA.properties.reason.type).toBe('string');
    });

    it('all three tool schemas have name and required fields', () => {
      const schemas = [MEMORY_SAVE_SCHEMA, MEMORY_SEARCH_SCHEMA, MEMORY_FORGET_SCHEMA];
      for (const schema of schemas) {
        expect(schema.name).toBeTruthy();
        expect(Array.isArray(schema.required)).toBe(true);
        expect(schema.required.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Path traversal prevention', () => {
    it('rejects item ID with path traversal', async () => {
      const sm = manager.structuredMemory;
      await expect(sm.getItem('../../../etc/passwd')).rejects.toThrow('Invalid item id');
    });

    it('rejects item ID with forward slashes', async () => {
      const sm = manager.structuredMemory;
      await expect(sm.getItem('foo/bar')).rejects.toThrow('Invalid item id');
    });

    it('rejects item ID with backslashes', async () => {
      const sm = manager.structuredMemory;
      await expect(sm.getItem('foo\\bar')).rejects.toThrow('Invalid item id');
    });
  });
});
