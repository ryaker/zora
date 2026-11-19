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

  it('registers the provenance label and edge in the ontology allowlists', () => {
    expect(NODE_LABELS).toContain('Memory');
    expect(EDGE_TYPES).toContain('EVIDENCED_BY');
  });

  it('inert client drops facts and answers sourcesOf empty (fail closed)', async () => {
    const client = await GraphMemoryClient.create({ enabled: false, ontology: true });
    client.recordFacts({ memId: 'm1', ts: 1, entities: [{ name: 'Zora', kind: 'project' }] });
    expect(await client.sourcesOf('Zora')).toEqual([]);
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

  it('links entities to the memory that evidences them', () => {
    store.recordFacts({
      memId: 'mem-1',
      ts: 100,
      entities: [{ name: 'Zora', kind: 'project' }, { name: 'SparrowDB', kind: 'tool' }],
    });
    expect(store.sourcesOf('Zora')).toEqual(['mem-1']);
    expect(store.sourcesOf('SparrowDB')).toEqual(['mem-1']);
    expect(store.sourcesOf('Unknown')).toEqual([]);
  });

  it('accumulates sources across memories and is replay-safe', () => {
    const facts = { memId: 'mem-1', ts: 1, entities: [{ name: 'Zora', kind: 'project' as const }] };
    store.recordFacts(facts);
    store.recordFacts(facts);
    store.recordFacts({ ...facts, memId: 'mem-2', ts: 2 });
    expect(store.sourcesOf('Zora').sort()).toEqual(['mem-1', 'mem-2']);
  });

  it('stores relations with the asserting memory and keeps them traversable', () => {
    store.recordFacts({
      memId: 'mem-9',
      ts: 5,
      entities: [],
      relations: [
        { from: { name: 'Zora', kind: 'project' }, to: { name: 'SparrowDB', kind: 'tool' }, kind: 'uses' },
      ],
    });
    expect(store.neighbours('Zora')).toEqual([
      { name: 'SparrowDB', kind: 'tool', relation: 'uses', direction: 'out' },
    ]);
    expect(store.sourcesOf('Zora')).toEqual(['mem-9']);
  });

  it('ignores an empty memory id and does not throw on junk', () => {
    store.recordFacts({ memId: '  ', ts: 1, entities: [{ name: 'X', kind: 'concept' }] });
    expect(store.sourcesOf('X')).toEqual([]);
  });

  it('applyWrites routes recordFacts', () => {
    store.applyWrites([
      { op: 'recordFacts', facts: { memId: 'm', ts: 1, entities: [{ name: 'A', kind: 'person' }] } },
    ]);
    expect(store.sourcesOf('A')).toEqual(['m']);
  });
});

describeIfNative('GraphMemoryClient ontology gate', { timeout: 30_000 }, () => {
  it('drops provenance writes when ontology is off even if the tier is on', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-onto-client-'));
    const client = await GraphMemoryClient.create({ enabled: true, ontology: false, path: path.join(dir, 'g.db') });
    client.recordFacts({ memId: 'm1', ts: 1, entities: [{ name: 'Zora', kind: 'project' }] });
    await client.flush();
    expect(await client.sourcesOf('Zora')).toEqual([]);
    expect((await client.stats()).entities).toBe(0);
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores and returns provenance when both flags are on', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-onto-client-'));
    const client = await GraphMemoryClient.create({ enabled: true, ontology: true, path: path.join(dir, 'g.db') });
    client.recordFacts({ memId: 'm1', ts: 1, entities: [{ name: 'Zora', kind: 'project' }] });
    await client.flush();
    expect(await client.sourcesOf('Zora')).toEqual(['m1']);
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
