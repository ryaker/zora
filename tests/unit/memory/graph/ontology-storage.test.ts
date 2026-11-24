/**
 * Auto-ontology storage (#194, PR 1): provenance schema + the default-off flag.
 * Store tests run on the real sparrowdb engine and skip when it is unavailable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GraphStore } from '../../../../src/memory/graph/graph-store.js';
import { GraphMemoryClient } from '../../../../src/memory/graph/graph-memory-worker.js';
import { loadSparrow } from '../../../../src/memory/graph/sparrow-loader.js';
import {
  DEFAULT_GRAPH_CONFIG,
  EDGE_TYPES,
  NODE_LABELS,
  graphConfigFromEnv,
} from '../../../../src/memory/graph/graph-types.js';

const sparrowAvailable = (await loadSparrow()).available;
const describeIfNative = sparrowAvailable ? describe : describe.skip;

describe('ontology config flag', () => {
  it('is off by default', () => {
    expect(DEFAULT_GRAPH_CONFIG.ontology).toBe(false);
    expect(graphConfigFromEnv({}).ontology).toBe(false);
  });

  it('turns on only via ZORA_GRAPH_ONTOLOGY, independently of the tier flag', () => {
    expect(graphConfigFromEnv({ ZORA_GRAPH_ONTOLOGY: '1' }).ontology).toBe(true);
    expect(graphConfigFromEnv({ ZORA_GRAPH_MEMORY: '1' }).ontology).toBe(false);
    expect(graphConfigFromEnv({ ZORA_GRAPH_ONTOLOGY: 'maybe' }).ontology).toBe(false);
  });

  it('registers the provenance labels and edge in the ontology allowlists', () => {
    expect(NODE_LABELS).toEqual(expect.arrayContaining(['Memory', 'OntEntity', 'Assertion']));
    expect(EDGE_TYPES).toContain('EVIDENCED_BY');
  });

  it('inert client drops facts and answers sourcesOf empty (fail closed)', async () => {
    const client = await GraphMemoryClient.create({ enabled: false, ontology: true });
    client.recordFacts({ memId: 'm1', ts: 1, entities: [{ name: 'Zora', kind: 'project' }] });
    expect(await client.sourcesOf('Zora', 'project')).toEqual([]);
    await client.close();
  });
});

describeIfNative('GraphStore provenance', { timeout: 30_000 }, () => {
  let tmpDir: string;
  let store: GraphStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-onto-test-'));
    store = null as unknown as GraphStore;
    const opened = await GraphStore.open({ path: path.join(tmpDir, 'graph.db') });
    if (!opened) throw new Error('GraphStore.open returned null while native is available');
    store = opened;
  });

  afterEach(async () => {
    store?.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const zora = { name: 'Zora', kind: 'project' as const };
  const sparrow = { name: 'SparrowDB', kind: 'tool' as const };

  it('links entities to the memories that evidence them, per kind', () => {
    store.recordFacts({ memId: 'mem-1', ts: 1, entities: [zora, sparrow] });
    store.recordFacts({ memId: 'mem-2', ts: 2, entities: [zora] });
    store.recordFacts({ memId: 'mem-3', ts: 3, entities: [{ name: 'Zora', kind: 'person' }] });
    store.recordFacts({ memId: 'mem-1', ts: 1, entities: [zora, sparrow] }); // replay
    expect(store.sourcesOf('Zora', 'project').sort()).toEqual(['mem-1', 'mem-2']);
    // A same-named entity of another kind is not sourced by the project mentions.
    expect(store.sourcesOf('Zora', 'person')).toEqual(['mem-3']);
    expect(store.sourcesOf('Nope', 'project')).toEqual([]);
  });

  it('attributes each relation assertion to exactly its own sources', () => {
    const rel = (kind: string) => ({ from: zora, to: sparrow, kind });
    store.recordFacts({ memId: 'a', ts: 1, entities: [], relations: [rel('uses')] });
    store.recordFacts({ memId: 'b', ts: 2, entities: [], relations: [rel('uses')] });
    store.recordFacts({ memId: 'c', ts: 3, entities: [], relations: [rel('replaces')] });
    store.recordFacts({ memId: 'a', ts: 1, entities: [], relations: [rel('uses')] }); // replay
    expect(store.relationSources(zora, sparrow, 'uses').sort()).toEqual(['a', 'b']);
    expect(store.relationSources(zora, sparrow, 'replaces')).toEqual(['c']);
    expect(store.relationSources(sparrow, zora, 'uses')).toEqual([]);
  });

  it('is invisible to legacy recall and does not collide with legacy edges', () => {
    store.relateEntities(zora, sparrow, 'uses'); // pre-existing legacy edge
    const legacyBefore = store.neighbours('Zora');
    const statsBefore = store.stats();
    store.recordFacts({
      memId: 'm',
      ts: 1,
      entities: [{ name: 'Onto', kind: 'concept' }],
      relations: [{ from: zora, to: sparrow, kind: 'uses' }, { from: zora, to: { name: 'Onto', kind: 'concept' }, kind: 'covers' }],
    });
    expect(store.neighbours('Zora')).toEqual(legacyBefore);
    expect(store.neighbours('Onto')).toEqual([]);
    expect(store.stats()).toEqual(statsBefore);
    expect(store.tasksMentioning('Onto')).toEqual([]);
    // The legacy edge did not stop the ontology source being recorded.
    expect(store.relationSources(zora, sparrow, 'uses')).toEqual(['m']);
  });

  it('ignores an empty memory id and self-relations', () => {
    store.recordFacts({ memId: '  ', ts: 1, entities: [zora] });
    store.recordFacts({ memId: 'm', ts: 1, entities: [], relations: [{ from: zora, to: zora, kind: 'is' }] });
    expect(store.sourcesOf('Zora', 'project')).toEqual(['m']);
    expect(store.relationSources(zora, zora, 'is')).toEqual([]);
  });

  it('never merges distinct identities that share a boundary prefix', () => {
    const p100 = 'p'.repeat(100);
    store.recordFacts({
      memId: 'x',
      ts: 1,
      entities: [],
      relations: [{ from: zora, to: sparrow, kind: p100 }],
    });
    // 101 chars is out of domain: rejected on write and on read, never truncated onto p100.
    store.recordFacts({
      memId: 'y',
      ts: 1,
      entities: [],
      relations: [{ from: zora, to: sparrow, kind: p100 + 'q' }],
    });
    expect(store.relationSources(zora, sparrow, p100)).toEqual(['x']);
    expect(store.relationSources(zora, sparrow, p100 + 'q')).toEqual([]);

    // Fresh entity names (not zora/sparrow) so the memory-ID case is isolated from the relation case above.
    const idEnt = { name: 'IdBoundaryA', kind: 'concept' as const };
    const idEnt2 = { name: 'IdBoundaryB', kind: 'concept' as const };
    const id200 = 'i'.repeat(200);
    store.recordFacts({ memId: id200, ts: 1, entities: [idEnt] });
    store.recordFacts({ memId: id200 + 'j', ts: 1, entities: [idEnt2] }); // 201: rejected
    expect(store.sourcesOf('IdBoundaryA', 'concept')).toEqual([id200]);
    expect(store.sourcesOf('IdBoundaryB', 'concept')).toEqual([]);

    // Opaque ids are exact: surrounding whitespace is not trimmed away.
    store.recordFacts({ memId: ' padded ', ts: 1, entities: [{ name: 'Pad', kind: 'concept' }] });
    expect(store.sourcesOf('Pad', 'concept')).toEqual([' padded ']);
  });

  it('applyWrites routes recordFacts', () => {
    store.applyWrites([{ op: 'recordFacts', facts: { memId: 'm', ts: 1, entities: [zora] } }]);
    expect(store.sourcesOf('Zora', 'project')).toEqual(['m']);
  });
});

describeIfNative('GraphMemoryClient ontology gate', { timeout: 30_000 }, () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-onto-client-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('off-mode writes are never persisted (verified by reopening with ontology on)', async () => {
    const dbPath = path.join(dir, 'g.db');
    const off = await GraphMemoryClient.create({ enabled: true, ontology: false, path: dbPath });
    off.recordFacts({
      memId: 'dropped',
      ts: 1,
      entities: [{ name: 'Ghost', kind: 'concept' }],
      relations: [{ from: { name: 'Ghost', kind: 'concept' }, to: { name: 'Zora', kind: 'project' }, kind: 'haunts' }],
    });
    // A legacy positive sentinel proves the DB was written and flushed.
    off.upsertEntity({ name: 'Sentinel', kind: 'concept' });
    await off.flush();
    expect(await off.sourcesOf('Ghost', 'concept')).toEqual([]);
    await off.close();

    const on = await GraphMemoryClient.create({ enabled: true, ontology: true, path: dbPath });
    expect((await on.stats()).entities).toBe(1); // sentinel persisted
    expect(await on.sourcesOf('Ghost', 'concept')).toEqual([]);
    expect(
      await on.relationSources({ name: 'Ghost', kind: 'concept' }, { name: 'Zora', kind: 'project' }, 'haunts'),
    ).toEqual([]);
    // Now write with the flag on and reopen with it off: ontology-only facts
    // stay out of legacy traversal.
    on.recordFacts({ memId: 'kept', ts: 2, entities: [{ name: 'Onto', kind: 'concept' }] });
    await on.flush();
    expect(await on.sourcesOf('Onto', 'concept')).toEqual(['kept']);
    await on.close();

    const off2 = await GraphMemoryClient.create({ enabled: true, ontology: false, path: dbPath });
    expect(await off2.sourcesOf('Onto', 'concept')).toEqual([]);
    expect(await off2.neighbours('Onto')).toEqual([]);
    expect((await off2.stats()).entities).toBe(1);
    await off2.close();
  });

  it('stores and returns provenance when both flags are on', async () => {
    const client = await GraphMemoryClient.create({ enabled: true, ontology: true, path: path.join(dir, 'g.db') });
    client.recordFacts({ memId: 'm1', ts: 1, entities: [{ name: 'Zora', kind: 'project' }] });
    await client.flush();
    expect(await client.sourcesOf('Zora', 'project')).toEqual(['m1']);
    await client.close();
  });
});
