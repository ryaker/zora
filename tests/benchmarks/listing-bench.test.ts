/**
 * PERF-02 benchmarks — measured, not asserted.
 *
 * Two hot listings that used to be O(total bytes on disk) per call:
 *
 *   1. `SessionManager.listSessions()` — called by the dashboard from both
 *      `/api/jobs` and `/api/history`, so every poll re-read every session file.
 *   2. `StructuredMemory.listItems()` — one `readFile` + `JSON.parse` per memory
 *      item, and `CategoryOrganizer` calls it repeatedly.
 *
 * Each benchmark below runs the ORIGINAL algorithm (reproduced verbatim in this
 * file as `legacy*`) against the same generated fixture as the current
 * implementation, asserts the two produce identical results, and prints the
 * timings. Scale: 500 sessions, 2000 memory items — both generated in-test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionManager } from '../../src/orchestrator/session-manager.js';
import { StructuredMemory } from '../../src/memory/structured-memory.js';
import type { AgentEvent } from '../../src/types.js';
import type { MemoryItem } from '../../src/memory/memory-types.js';

const SESSION_COUNT = 500;
const EVENTS_PER_SESSION = 80;
const MEMORY_ITEM_COUNT = 2000;

/** Time an async fn over N iterations, returning ms/call. */
async function timeAvg(iterations: number, fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  return (performance.now() - start) / iterations;
}

function pct(before: number, after: number): string {
  if (after === 0) return '∞';
  return `${(before / after).toFixed(1)}x faster`;
}

// ─── Legacy implementations (pre-PERF-02), reproduced for comparison ──────────

interface LegacySession {
  jobId: string;
  eventCount: number;
  lastActivity: Date | null;
  status: string;
}

/** session-manager.ts:166-208 as it stood before PERF-02. */
async function legacyListSessions(sessionsDir: string): Promise<LegacySession[]> {
  const sessions: LegacySession[] = [];
  try {
    const files = await fs.readdir(sessionsDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const jobId = file.replace(/\.jsonl$/, '');
      const filePath = path.join(sessionsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        const eventCount = lines.length;
        let lastActivity: Date | null = null;
        let status = 'unknown';
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1]!;
          try {
            const lastEvent = JSON.parse(lastLine) as AgentEvent;
            lastActivity = new Date(lastEvent.timestamp);
            status = lastEvent.type === 'done' ? 'completed'
              : lastEvent.type === 'error' ? 'failed'
              : 'running';
          } catch { /* malformed last line */ }
        }
        sessions.push({ jobId, eventCount, lastActivity, status });
      } catch {
        sessions.push({ jobId, eventCount: 0, lastActivity: null, status: 'unknown' });
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return sessions;
}

/** structured-memory.ts `_readAllItems()` as it stood before the item cache. */
async function legacyReadAllItems(itemsDir: string): Promise<MemoryItem[]> {
  let files: string[];
  try {
    files = await fs.readdir(itemsDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const items: MemoryItem[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = await fs.readFile(path.join(itemsDir, file), 'utf8');
      items.push(JSON.parse(data) as MemoryItem);
    } catch { /* skip corrupt */ }
  }
  return items;
}

// ─── SessionManager.listSessions() ────────────────────────────────────────────

describe('PERF-02 — SessionManager.listSessions()', () => {
  let baseDir: string;
  let sessionsDir: string;

  beforeAll(async () => {
    baseDir = path.join(os.tmpdir(), `zora-bench-sessions-${Date.now()}`);
    sessionsDir = path.join(baseDir, 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });

    // Realistic transcripts: mixed event types, a trailing 'done'/'error'.
    for (let s = 0; s < SESSION_COUNT; s++) {
      const lines: string[] = [];
      for (let e = 0; e < EVENTS_PER_SESSION; e++) {
        const last = e === EVENTS_PER_SESSION - 1;
        lines.push(JSON.stringify({
          type: last ? (s % 7 === 0 ? 'error' : 'done') : (e % 3 === 0 ? 'tool_call' : 'text'),
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, s % 60, e)).toISOString(),
          content: { text: `session ${s} event ${e} — ${'lorem ipsum dolor sit amet '.repeat(6)}` },
        }));
      }
      await fs.writeFile(path.join(sessionsDir, `bench-job-${s}.jsonl`), lines.join('\n') + '\n', 'utf8');
    }
  }, 120_000);

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('warm index beats the full-file scan and returns identical results', async () => {
    let bytes = 0;
    for (const f of await fs.readdir(sessionsDir)) {
      bytes += (await fs.stat(path.join(sessionsDir, f))).size;
    }

    // BEFORE: the original full-read-per-file scan.
    const beforeMs = await timeAvg(5, () => legacyListSessions(sessionsDir));

    // AFTER (cold): no index on disk yet — first call scans everything and
    // seeds the index, so it is expected to cost roughly the same as BEFORE.
    const sm = new SessionManager(baseDir);
    const coldStart = performance.now();
    const coldResult = await sm.listSessions();
    const coldMs = performance.now() - coldStart;

    // AFTER (warm): index is populated — readdir + one stat() per file.
    const warmMs = await timeAvg(5, () => sm.listSessions());

    // AFTER (cold process, index persisted to disk): what a restarted daemon sees.
    await sm.flushIndex();
    const sm2 = new SessionManager(baseDir);
    const restartStart = performance.now();
    const restartResult = await sm2.listSessions();
    const restartMs = performance.now() - restartStart;

    // Correctness: identical to the legacy scan, field for field.
    const legacy = await legacyListSessions(sessionsDir);
    const key = (s: LegacySession) =>
      `${s.jobId}|${s.eventCount}|${s.lastActivity?.toISOString() ?? 'null'}|${s.status}`;
    const legacyKeys = legacy.map(key).sort();
    expect(coldResult.map(key).sort()).toEqual(legacyKeys);
    expect((await sm.listSessions()).map(key).sort()).toEqual(legacyKeys);
    expect(restartResult.map(key).sort()).toEqual(legacyKeys);
    expect(coldResult).toHaveLength(SESSION_COUNT);

    console.log(
      `\n[PERF-02] listSessions() — ${SESSION_COUNT} sessions, ` +
      `${EVENTS_PER_SESSION} events each, ${(bytes / 1024 / 1024).toFixed(1)} MB on disk\n` +
      `  before (full scan, per call)      : ${beforeMs.toFixed(1)} ms\n` +
      `  after  (cold, index being built)  : ${coldMs.toFixed(1)} ms\n` +
      `  after  (warm index, per call)     : ${warmMs.toFixed(1)} ms   ← ${pct(beforeMs, warmMs)}\n` +
      `  after  (new process, index reload): ${restartMs.toFixed(1)} ms   ← ${pct(beforeMs, restartMs)}\n`
    );

    // The warm path must not read file contents at all — it should be far cheaper.
    expect(warmMs).toBeLessThan(beforeMs);
  }, 120_000);

  it('self-heals when the index is deleted or a file changes underneath it', async () => {
    const sm = new SessionManager(baseDir);
    await sm.listSessions();
    await sm.flushIndex();

    // Index deleted out from under us → full rescan, same answer.
    await fs.rm(path.join(baseDir, 'sessions-index.json'), { force: true });
    const healed = await new SessionManager(baseDir).listSessions();
    expect(healed).toHaveLength(SESSION_COUNT);

    // A session appended to by another process → size changes → that one session
    // is rescanned, and the new event count is reflected.
    const target = path.join(sessionsDir, 'bench-job-0.jsonl');
    const before = (await sm.listSessions()).find(s => s.jobId === 'bench-job-0')!;
    await fs.appendFile(target, JSON.stringify({ type: 'done', timestamp: new Date().toISOString(), content: {} }) + '\n');
    const after = (await sm.listSessions()).find(s => s.jobId === 'bench-job-0')!;
    expect(after.eventCount).toBe(before.eventCount + 1);

    // A brand new session file appears → picked up.
    await fs.writeFile(
      path.join(sessionsDir, 'bench-job-new.jsonl'),
      JSON.stringify({ type: 'done', timestamp: new Date().toISOString(), content: {} }) + '\n',
    );
    expect((await sm.listSessions()).some(s => s.jobId === 'bench-job-new')).toBe(true);

    // ...and removed again → dropped from the listing.
    await fs.rm(path.join(sessionsDir, 'bench-job-new.jsonl'));
    expect((await sm.listSessions()).some(s => s.jobId === 'bench-job-new')).toBe(false);
  }, 120_000);

  it('tolerates corrupt lines exactly as the full scan did', async () => {
    const dir = path.join(os.tmpdir(), `zora-bench-corrupt-${Date.now()}`);
    const sessions = path.join(dir, 'sessions');
    await fs.mkdir(sessions, { recursive: true });
    const good = JSON.stringify({ type: 'text', timestamp: '2026-01-01T00:00:00.000Z', content: {} });
    // Malformed middle line, blank line, malformed trailing line.
    await fs.writeFile(path.join(sessions, 'c.jsonl'), `${good}\n{"broken": json}\n\n{"also broken"\n`);

    const sm = new SessionManager(dir);
    const [fresh] = await sm.listSessions();
    const [legacy] = await legacyListSessions(sessions);

    expect(fresh!.eventCount).toBe(legacy!.eventCount);
    expect(fresh!.status).toBe(legacy!.status);
    expect(fresh!.lastActivity).toBeNull();
    // Second call comes from the index and must agree.
    const [warm] = await sm.listSessions();
    expect(warm).toEqual(fresh);

    await fs.rm(dir, { recursive: true, force: true });
  });
});

// ─── StructuredMemory.listItems() ─────────────────────────────────────────────

describe('PERF-02 — StructuredMemory.listItems()', () => {
  let root: string;
  let itemsDir: string;

  beforeAll(async () => {
    root = path.join(os.tmpdir(), `zora-bench-memory-${Date.now()}`);
    itemsDir = path.join(root, 'items');
    await fs.mkdir(itemsDir, { recursive: true });

    const types = ['knowledge', 'profile', 'event', 'tool', 'skill', 'behavior'];
    for (let i = 0; i < MEMORY_ITEM_COUNT; i++) {
      const id = `mem_1700000000000_${i.toString(16).padStart(8, '0')}`;
      const item: MemoryItem = {
        id,
        type: types[i % types.length] as MemoryItem['type'],
        summary: `Item ${i}: typescript generics inference across ${i % 17} modules — ${'context '.repeat(8)}`,
        source: `session-${i % 50}`,
        source_type: i % 3 === 0 ? 'user_instruction' : 'agent_analysis',
        tags: [`tag-${i % 25}`, `tag-${i % 7}`, 'benchmark'],
        category: `coding/topic-${i % 13}`,
        created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        last_accessed: new Date(Date.UTC(2026, 0, 2)).toISOString(),
        access_count: i % 9,
        reinforcement_score: 0,
      };
      await fs.writeFile(path.join(itemsDir, `${id}.json`), JSON.stringify(item, null, 2), 'utf8');
    }
  }, 120_000);

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('cached listing beats per-item reads and returns identical items', async () => {
    // BEFORE: one readFile + JSON.parse per item, every call.
    const beforeMs = await timeAvg(5, () => legacyReadAllItems(itemsDir));

    const mem = new StructuredMemory(itemsDir);
    // init() rebuilds the MiniSearch index, which is itself a full read.
    const initStart = performance.now();
    await mem.init();
    const initMs = performance.now() - initStart;

    // AFTER (warm): readdir + cache lookups.
    const warmMs = await timeAvg(5, () => mem.listItems());

    // AFTER (cold instance whose serialized MiniSearch index loads cleanly —
    // the search index is warm but the item cache is empty, the worst case).
    const mem2 = new StructuredMemory(itemsDir);
    await mem2.init();
    const coldStart = performance.now();
    await mem2.listItems();
    const coldMs = performance.now() - coldStart;
    const warm2Ms = await timeAvg(5, () => mem2.listItems());

    // Correctness: same items, same fields, same order as the legacy read.
    const legacy = await legacyReadAllItems(itemsDir);
    const now = await mem.listItems();
    expect(now).toHaveLength(MEMORY_ITEM_COUNT);
    expect(now.map(i => i.id)).toEqual(legacy.map(i => i.id));
    expect(JSON.stringify(now)).toBe(JSON.stringify(legacy));

    // Filters unchanged.
    expect(await mem.listItems({ type: 'knowledge' })).toHaveLength(
      legacy.filter(i => i.type === 'knowledge').length,
    );
    expect(await mem.listItems({ category: 'coding/topic-3' })).toHaveLength(
      legacy.filter(i => i.category === 'coding/topic-3').length,
    );
    expect(await mem.listItems({ tags: ['benchmark', 'tag-1'] })).toHaveLength(
      legacy.filter(i => i.tags.includes('benchmark') && i.tags.includes('tag-1')).length,
    );

    // MiniSearch behaviour is untouched: same hits from a warm and a cold instance.
    const q = 'typescript generics';
    const hitsWarm = (await mem.searchItems(q)).map(i => i.id).sort();
    const hitsCold = (await mem2.searchItems(q)).map(i => i.id).sort();
    expect(hitsWarm.length).toBeGreaterThan(0);
    expect(hitsCold).toEqual(hitsWarm);

    console.log(
      `\n[PERF-02] StructuredMemory.listItems() — ${MEMORY_ITEM_COUNT} items\n` +
      `  before (read every file, per call): ${beforeMs.toFixed(1)} ms\n` +
      `  init() (index rebuild, one-off)   : ${initMs.toFixed(1)} ms\n` +
      `  after  (warm cache, per call)     : ${warmMs.toFixed(1)} ms   ← ${pct(beforeMs, warmMs)}\n` +
      `  after  (cold cache, first call)   : ${coldMs.toFixed(1)} ms\n` +
      `  after  (then warm, per call)      : ${warm2Ms.toFixed(1)} ms   ← ${pct(beforeMs, warm2Ms)}\n`
    );

    expect(warmMs).toBeLessThan(beforeMs);
  }, 120_000);

  it('reflects creates and deletes made through the API', async () => {
    const dir = path.join(os.tmpdir(), `zora-bench-mem-inval-${Date.now()}`);
    const mem = new StructuredMemory(path.join(dir, 'items'));
    await mem.init();

    const a = await mem.createItem({
      type: 'knowledge', summary: 'alpha', source: 's', source_type: 'agent_analysis',
      tags: ['x'], category: 'coding/x',
    });
    expect(await mem.listItems()).toHaveLength(1);

    await mem.updateItem(a.id, { summary: 'alpha updated' });
    expect((await mem.listItems())[0]!.summary).toBe('alpha updated');

    await mem.deleteItem(a.id);
    expect(await mem.listItems()).toHaveLength(0);

    // An item written directly to disk by another process is still picked up,
    // because readdir — not the cache — decides what exists.
    const foreign = 'mem_1700000000001_deadbeef';
    await fs.writeFile(
      path.join(dir, 'items', `${foreign}.json`),
      JSON.stringify({
        id: foreign, type: 'event', summary: 'external', source: 's',
        source_type: 'tool_output', tags: [], category: 'events/e',
        created_at: new Date().toISOString(), last_accessed: new Date().toISOString(),
        access_count: 0, reinforcement_score: 0,
      }),
    );
    const listed = await mem.listItems();
    expect(listed.map(i => i.id)).toContain(foreign);

    // Corrupt file is skipped, not fatal.
    await fs.writeFile(path.join(dir, 'items', 'mem_bad.json'), '{not json');
    expect(await mem.listItems()).toHaveLength(1);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
