import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ObservationStore, type ObservationBlock } from '../../../src/memory/observation-store.js';

describe('ObservationStore', () => {
  let tmpDir: string;
  let store: ObservationStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-obs-test-'));
    store = new ObservationStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeBlock(overrides: Partial<ObservationBlock> = {}): ObservationBlock {
    return {
      id: ObservationStore.generateId(),
      sessionId: 'test-session',
      createdAt: new Date().toISOString(),
      tier: 'session',
      observations: '[2026-02-16 14:00] NOTE — Test observation',
      sourceMessageRange: [0, 10],
      estimatedTokens: 20,
      ...overrides,
    };
  }

  it('generates unique IDs', () => {
    const id1 = ObservationStore.generateId();
    const id2 = ObservationStore.generateId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^obs_\d+_[a-z0-9]+$/);
  });

  it('appends and loads session observations', async () => {
    const block = makeBlock();
    await store.append(block);

    const loaded = await store.loadSession('test-session');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(block.id);
    expect(loaded[0]!.observations).toBe(block.observations);
  });

  it('appends multiple blocks in order', async () => {
    const block1 = makeBlock({ observations: 'First' });
    const block2 = makeBlock({ observations: 'Second' });

    await store.append(block1);
    await store.append(block2);

    const loaded = await store.loadSession('test-session');
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.observations).toBe('First');
    expect(loaded[1]!.observations).toBe('Second');
  });

  it('returns empty array for nonexistent session', async () => {
    const loaded = await store.loadSession('nonexistent');
    expect(loaded).toEqual([]);
  });

  it('appends and loads cross-session observations', async () => {
    const block = makeBlock({ tier: 'cross-session' });
    await store.append(block);

    const loaded = await store.loadCrossSession();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.tier).toBe('cross-session');
  });

  it('limits cross-session observations', async () => {
    for (let i = 0; i < 5; i++) {
      await store.append(makeBlock({ tier: 'cross-session', observations: `Obs ${i}` }));
    }

    const limited = await store.loadCrossSession(3);
    expect(limited).toHaveLength(3);
    // Should return the most recent 3
    expect(limited[0]!.observations).toBe('Obs 2');
    expect(limited[2]!.observations).toBe('Obs 4');
  });

  it('builds session context from all blocks', async () => {
    await store.append(makeBlock({ observations: 'Line 1' }));
    await store.append(makeBlock({ observations: 'Line 2' }));

    const context = await store.buildSessionContext('test-session');
    expect(context).toContain('Line 1');
    expect(context).toContain('Line 2');
  });

  it('returns empty string for empty session', async () => {
    const context = await store.buildSessionContext('empty-session');
    expect(context).toBe('');
  });

  it('tracks token counts per session', async () => {
    await store.append(makeBlock({ estimatedTokens: 100 }));
    await store.append(makeBlock({ estimatedTokens: 200 }));

    const total = await store.getSessionTokenCount('test-session');
    expect(total).toBe(300);
  });

  it('skips malformed lines on load', async () => {
    const filePath = path.join(tmpDir, 'test-session.jsonl');
    const goodBlock = makeBlock();
    await fs.writeFile(filePath, JSON.stringify(goodBlock) + '\n{bad json}\n', { mode: 0o600 });

    const loaded = await store.loadSession('test-session');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(goodBlock.id);
  });

  it('sanitizes session IDs to prevent path traversal', async () => {
    const block = makeBlock({ sessionId: '../../../etc/passwd' });
    await store.append(block);

    // Should create a safe filename, not traverse directories
    const files = await fs.readdir(tmpDir);
    expect(files.every(f => !f.includes('..'))).toBe(true);
  });

  it('prunes old session files', async () => {
    // Create 5 session files
    for (let i = 0; i < 5; i++) {
      await store.append(makeBlock({ sessionId: `session-${String(i).padStart(3, '0')}` }));
    }

    const removed = await store.pruneOldSessions(3);
    expect(removed).toBe(2);

    const files = await fs.readdir(tmpDir);
    const sessionFiles = files.filter(f => f.endsWith('.jsonl'));
    expect(sessionFiles).toHaveLength(3);
  });
});
