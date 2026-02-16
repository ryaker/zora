/**
 * Progressive Context Management Tests.
 *
 * Tests the new progressive loading pattern:
 * - getMemoryIndex() returns stats only (no item reads)
 * - loadContext() returns lightweight index string
 * - recallMemory() returns query-relevant items
 * - recallDailyNotes() returns only requested days
 * - consolidateDailyNotes() archives old notes
 * - BufferedSessionWriter batches disk I/O
 * - SteeringManager.cachedGetPendingMessages debounces polls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import { SessionManager, BufferedSessionWriter } from '../../../src/orchestrator/session-manager.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import type { MemoryConfig, AgentEvent } from '../../../src/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Test Config ─────────────────────────────────────────────────────

function makeConfig(): MemoryConfig {
  return {
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
}

function makeEvent(type: string, text: string): AgentEvent {
  return {
    type: type as AgentEvent['type'],
    timestamp: new Date(),
    content: { text },
  };
}

// ── Progressive Memory Tests ────────────────────────────────────────

describe('Progressive Context — MemoryManager', () => {
  let baseDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    baseDir = path.join(os.tmpdir(), `zora-prog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    manager = new MemoryManager(makeConfig(), baseDir);
    await manager.init();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  describe('getMemoryIndex()', () => {
    it('returns zero counts for fresh memory', async () => {
      const index = await manager.getMemoryIndex();
      expect(index.itemCount).toBe(0);
      expect(index.categoryNames).toEqual([]);
      expect(index.dailyNoteCount).toBe(0);
      expect(index.mostRecentDailyNote).toBeNull();
    });

    it('counts items without reading their contents', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Item ${i}`,
          source: 's',
          source_type: 'agent_analysis',
          tags: [],
          category: `cat/${i}`,
        });
      }

      const index = await manager.getMemoryIndex();
      expect(index.itemCount).toBe(5);
    });

    it('detects daily notes by filename pattern', async () => {
      const dailyDir = path.join(baseDir, 'memory', 'daily');
      await fs.writeFile(path.join(dailyDir, '2026-02-13.md'), 'Day 13');
      await fs.writeFile(path.join(dailyDir, '2026-02-14.md'), 'Day 14');
      // Non-matching file should be ignored
      await fs.writeFile(path.join(dailyDir, 'notes.txt'), 'Not a daily note');

      manager.invalidateIndex();
      const index = await manager.getMemoryIndex();
      expect(index.dailyNoteCount).toBe(2);
      expect(index.mostRecentDailyNote).toBe('2026-02-14');
    });

    it('caches the index until invalidated', async () => {
      const idx1 = await manager.getMemoryIndex();
      const idx2 = await manager.getMemoryIndex();
      expect(idx1).toBe(idx2); // Same object reference

      manager.invalidateIndex();
      const idx3 = await manager.getMemoryIndex();
      expect(idx3).not.toBe(idx1); // New object
    });
  });

  describe('loadContext()', () => {
    it('returns lightweight index, not full dump', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Should not appear in progressive context',
        source: 's',
        source_type: 'user_instruction',
        tags: ['test'],
        category: 'coding/test',
      });

      const context = await manager.loadContext();
      const joined = context.join('\n');

      // Should include memory index
      expect(joined).toContain('[MEMORY]');
      expect(joined).toContain('1 items');
      expect(joined).toContain('memory_search');
      expect(joined).toContain('recall_context');
      expect(joined).toContain('memory_save');

      // Should NOT include item content
      expect(joined).not.toContain('Should not appear in progressive context');
      expect(joined).not.toContain('[MEMORY ITEMS]');
      expect(joined).not.toContain('[CATEGORY SUMMARIES]');
    });

    it('still includes MEMORY.md (long-term memory)', async () => {
      const ltPath = path.join(baseDir, 'memory', 'MEMORY.md');
      await fs.writeFile(ltPath, '# Memory\n\n- User likes TypeScript\n');

      const context = await manager.loadContext();
      expect(context.some(c => c.includes('[LONG-TERM MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('User likes TypeScript'))).toBe(true);
    });
  });

  describe('recallMemory()', () => {
    it('returns items matching query', async () => {
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'TypeScript has strict null checks',
        source: 's',
        source_type: 'user_instruction',
        tags: ['typescript'],
        category: 'coding/ts',
      });
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Python uses indentation for blocks',
        source: 's',
        source_type: 'agent_analysis',
        tags: ['python'],
        category: 'coding/py',
      });

      const result = await manager.recallMemory('typescript');
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items[0]!.summary).toContain('TypeScript');
      expect(result.scores.length).toBe(result.items.length);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await manager.structuredMemory.createItem({
          type: 'knowledge',
          summary: `Testing item ${i} with testing keyword`,
          source: 's',
          source_type: 'agent_analysis',
          tags: ['testing'],
          category: 'coding/test',
        });
      }

      const result = await manager.recallMemory('testing', 3);
      expect(result.items.length).toBeLessThanOrEqual(3);
    });
  });

  describe('recallDailyNotes()', () => {
    it('returns only requested number of days', async () => {
      const dailyDir = path.join(baseDir, 'memory', 'daily');
      await fs.writeFile(path.join(dailyDir, '2026-02-10.md'), 'Day 10');
      await fs.writeFile(path.join(dailyDir, '2026-02-11.md'), 'Day 11');
      await fs.writeFile(path.join(dailyDir, '2026-02-12.md'), 'Day 12');
      await fs.writeFile(path.join(dailyDir, '2026-02-13.md'), 'Day 13');

      const notes = await manager.recallDailyNotes(2);
      expect(notes.length).toBe(2);
      expect(notes.some(n => n.includes('2026-02-13'))).toBe(true);
      expect(notes.some(n => n.includes('2026-02-12'))).toBe(true);
      expect(notes.some(n => n.includes('2026-02-10'))).toBe(false);
    });
  });

  describe('consolidateDailyNotes()', () => {
    it('archives notes older than threshold', async () => {
      const dailyDir = path.join(baseDir, 'memory', 'daily');
      // Create notes — old ones will be more than 7 days ago
      await fs.writeFile(path.join(dailyDir, '2025-01-01.md'), 'Very old note');
      await fs.writeFile(path.join(dailyDir, '2025-01-02.md'), 'Also old note');

      const today = new Date().toISOString().split('T')[0];
      await fs.writeFile(path.join(dailyDir, `${today}.md`), 'Today note');

      const count = await manager.consolidateDailyNotes(7);
      expect(count).toBe(2); // Two old notes consolidated

      // Old notes should be moved to archive
      const archiveDir = path.join(dailyDir, 'archive');
      const archived = await fs.readdir(archiveDir);
      expect(archived).toContain('2025-01-01.md');
      expect(archived).toContain('2025-01-02.md');

      // Today's note should remain
      const remaining = await fs.readdir(dailyDir);
      expect(remaining).toContain(`${today}.md`);
    });

    it('returns 0 when no old notes exist', async () => {
      const count = await manager.consolidateDailyNotes(7);
      expect(count).toBe(0);
    });

    it('appends consolidation summary to MEMORY.md', async () => {
      const dailyDir = path.join(baseDir, 'memory', 'daily');
      await fs.writeFile(path.join(dailyDir, '2025-01-01.md'), 'Old note');

      await manager.consolidateDailyNotes(7);

      const ltContent = await fs.readFile(path.join(baseDir, 'memory', 'MEMORY.md'), 'utf8');
      expect(ltContent).toContain('Archived');
    });
  });

  describe('loadFullContext() backward compat', () => {
    it('returns full dump with all tiers', async () => {
      const ltPath = path.join(baseDir, 'memory', 'MEMORY.md');
      await fs.writeFile(ltPath, '# Memory\n\n- Fact from long-term\n');
      await manager.appendDailyNote('Daily note content');
      await manager.structuredMemory.createItem({
        type: 'knowledge',
        summary: 'Structured item content',
        source: 's',
        source_type: 'agent_analysis',
        tags: [],
        category: 'general/test',
      });

      const context = await manager.loadFullContext();
      expect(context.some(c => c.includes('[LONG-TERM MEMORY]'))).toBe(true);
      expect(context.some(c => c.includes('[RECENT CONTEXT]'))).toBe(true);
      expect(context.some(c => c.includes('Fact from long-term'))).toBe(true);
      expect(context.some(c => c.includes('Daily note content'))).toBe(true);
    });
  });
});

// ── BufferedSessionWriter Tests ─────────────────────────────────────

describe('BufferedSessionWriter', () => {
  let baseDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    baseDir = path.join(os.tmpdir(), `zora-buf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(path.join(baseDir, 'sessions'), { recursive: true });
    sessionManager = new SessionManager(baseDir);
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('batches events and writes on flush', async () => {
    const writer = new BufferedSessionWriter(sessionManager, 'test-job', 60000); // Long interval so we control flush

    writer.append(makeEvent('text', 'Hello'));
    writer.append(makeEvent('text', 'World'));

    // Not yet written to disk
    const beforeFlush = await sessionManager.getHistory('test-job');
    expect(beforeFlush.length).toBe(0);

    // Flush
    await writer.flush();

    const afterFlush = await sessionManager.getHistory('test-job');
    expect(afterFlush.length).toBe(2);

    await writer.close();
  });

  it('close() flushes remaining events', async () => {
    const writer = new BufferedSessionWriter(sessionManager, 'test-job-2', 60000);

    writer.append(makeEvent('text', 'Pending'));
    await writer.close();

    const history = await sessionManager.getHistory('test-job-2');
    expect(history.length).toBe(1);
  });

  it('handles empty buffer gracefully', async () => {
    const writer = new BufferedSessionWriter(sessionManager, 'empty-job', 60000);

    await writer.flush(); // No-op
    await writer.close();

    const history = await sessionManager.getHistory('empty-job');
    expect(history.length).toBe(0);
  });
});

// ── SteeringManager Cache Tests ─────────────────────────────────────

describe('SteeringManager.cachedGetPendingMessages', () => {
  let baseDir: string;
  let steering: SteeringManager;

  beforeEach(async () => {
    baseDir = path.join(os.tmpdir(), `zora-steer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    steering = new SteeringManager(baseDir);
    await steering.init();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('returns cached result within maxAgeMs', async () => {
    // First call — fetches from disk
    const result1 = await steering.cachedGetPendingMessages('job-1', 5000);
    expect(result1).toEqual([]);

    // Second call within cache window — should not re-read disk
    const result2 = await steering.cachedGetPendingMessages('job-1', 5000);
    expect(result2).toEqual([]);
    // Both should be same array reference if cached
    expect(result1).toBe(result2);
  });

  it('invalidates cache when told to', async () => {
    await steering.cachedGetPendingMessages('job-2', 5000);

    steering.invalidatePendingCache('job-2');

    // After invalidation, a new fetch happens
    const result = await steering.cachedGetPendingMessages('job-2', 5000);
    expect(result).toEqual([]);
  });
});
