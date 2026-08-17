/**
 * Graceful-degradation tests.
 *
 * The graph tier is optional in three independent ways — a config flag that
 * defaults to off, an optionalDependency that may not be installed, and a
 * native binary that does not exist for every platform. Each of those must
 * leave the rest of Zora working exactly as before: no throw at boot, no
 * throw at call sites, one warning.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadSparrow,
  resetSparrowLoaderCache,
} from '../../../../src/memory/graph/sparrow-loader.js';
import { GraphStore } from '../../../../src/memory/graph/graph-store.js';
import { resetGraphLockRegistry } from '../../../../src/memory/graph/process-lock.js';
import { GraphMemoryClient } from '../../../../src/memory/graph/graph-memory-worker.js';
import { createGraphTools } from '../../../../src/tools/graph-tools.js';
import {
  DEFAULT_GRAPH_CONFIG,
  graphConfigFromEnv,
} from '../../../../src/memory/graph/graph-types.js';

afterEach(() => {
  resetSparrowLoaderCache();
});

describe('configuration', () => {
  it('defaults to OFF', () => {
    expect(DEFAULT_GRAPH_CONFIG.enabled).toBe(false);
    expect(graphConfigFromEnv({}).enabled).toBe(false);
  });

  it('is enabled only by an explicit affirmative flag', () => {
    for (const value of ['1', 'true', 'on', 'yes', 'TRUE', ' on ']) {
      expect(graphConfigFromEnv({ ZORA_GRAPH_MEMORY: value }).enabled).toBe(true);
    }
    for (const value of ['', '0', 'false', 'off', 'no', 'maybe']) {
      expect(graphConfigFromEnv({ ZORA_GRAPH_MEMORY: value }).enabled).toBe(false);
    }
  });

  it('takes a path override from the environment', () => {
    expect(graphConfigFromEnv({ ZORA_GRAPH_MEMORY_PATH: '/tmp/g.db' }).path).toBe('/tmp/g.db');
  });

  it('lets explicit overrides win over the environment', () => {
    const config = graphConfigFromEnv({ ZORA_GRAPH_MEMORY: '1' }, { enabled: false });
    expect(config.enabled).toBe(false);
  });
});

describe('loadSparrow', () => {
  it('reports unavailable instead of throwing when the module is missing', async () => {
    const result = await loadSparrow(() => Promise.reject(new Error("Cannot find module 'sparrowdb'")));
    expect(result.available).toBe(false);
    expect(result.available === false && result.reason).toContain('Cannot find module');
  });

  it('reports unavailable when the native binary fails to load', async () => {
    const result = await loadSparrow(() =>
      Promise.reject(new Error('sparrowdb: could not load native module for linux-arm64')),
    );
    expect(result.available).toBe(false);
  });

  it('reports unavailable when the module exports no SparrowDB', async () => {
    const result = await loadSparrow(() => Promise.resolve({ default: {} }));
    expect(result.available).toBe(false);
    expect(result.available === false && result.reason).toContain('no SparrowDB');
  });

  it('accepts the CJS default-interop shape that real Node ESM produces', async () => {
    // `sparrowdb` is CJS with no exports map, so under Node ESM the namespace
    // has only `default`. Vitest's interop adds named exports; production does
    // not. Both must load.
    const fake = { SparrowDB: { open: () => ({}) } };
    const viaDefault = await loadSparrow(() => Promise.resolve({ default: fake }));
    expect(viaDefault.available).toBe(true);

    resetSparrowLoaderCache();
    const viaNamed = await loadSparrow(() => Promise.resolve(fake));
    expect(viaNamed.available).toBe(true);
  });

  it('memoizes the result so an unavailable module is probed once', async () => {
    const importer = vi.fn(() => Promise.reject(new Error('nope')));
    await loadSparrow(importer);
    await loadSparrow(importer);
    await loadSparrow(importer);
    expect(importer).toHaveBeenCalledTimes(1);
  });
});

describe('GraphStore when the engine is unavailable', () => {
  it('returns null rather than a half-built object', async () => {
    await loadSparrow(() => Promise.reject(new Error('nope')));
    const store = await GraphStore.open({ path: '/nonexistent/graph.db' });
    expect(store).toBeNull();
  });

  it('returns null when the database cannot be opened', async () => {
    const store = await GraphStore.open({
      path: '/graph.db',
      module: {
        SparrowDB: {
          open: () => {
            throw new Error('EACCES: permission denied');
          },
        },
      },
    });
    expect(store).toBeNull();
  });
});

describe('GraphStore when another process holds the database (MEM-35)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    resetGraphLockRegistry();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-held-'));
    dbPath = path.join(tmpDir, 'graph.db');
  });

  afterEach(async () => {
    resetGraphLockRegistry();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('goes inert rather than opening a database a live process already holds', async () => {
    // Two writers on one SparrowDB root can leave it permanently unopenable
    // (SparrowDB #524), so this degrade is the point of the lock, not a
    // consequence of it. `process.ppid` stands in for the daemon: a real, live
    // process that is not this one.
    await fs.mkdir(dbPath, { recursive: true });
    await fs.writeFile(
      path.join(dbPath, '.zora-graph.lock'),
      JSON.stringify({ pid: process.ppid, host: os.hostname(), startedAt: '' }),
    );

    expect(await GraphStore.open({ path: dbPath })).toBeNull();
  });

  it("relays upstream's own lock refusal through the same inert path", async () => {
    // On a runtime carrying SparrowDB's cross-process flock, a holder Zora's
    // advisory lock cannot see — the sparrowdb CLI, the SparrowDB MCP server —
    // is refused by the engine instead. Same outcome, no stack trace.
    const store = await GraphStore.open({
      path: dbPath,
      module: {
        SparrowDB: {
          open: () => {
            throw new Error(
              `database locked: another process already has '${dbPath}' open for writing. ` +
                'SparrowDB allows only one open handle per database root at a time — close the ' +
                "other process's connection (or wait for it to exit) and retry.",
            );
          },
        },
      },
    });
    expect(store).toBeNull();
  });

  it('releases the database on close, so the next process can open it', async () => {
    const first = await GraphStore.open({ path: dbPath });
    if (!first) return; // no native module on this platform
    first.close();

    // A fresh process would have an empty registry; clearing it makes the
    // on-disk lock the only thing standing between the two opens.
    resetGraphLockRegistry();
    const second = await GraphStore.open({ path: dbPath });
    expect(second).not.toBeNull();
    second?.close();
  });
});

describe('GraphMemoryClient when the tier is inert', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-off-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('starts without throwing when disabled, and reports why', async () => {
    const client = await GraphMemoryClient.create({ enabled: false });
    expect(client.available).toBe(false);
    expect(client.unavailableReason).toContain('disabled');
    await client.close();
  });

  it('never spawns a worker when disabled', async () => {
    // A disabled tier must cost nothing: no thread, no database file.
    const dbPath = path.join(tmpDir, 'graph.db');
    const client = await GraphMemoryClient.create({ enabled: false, path: dbPath });
    await client.flush();
    await client.close();
    await expect(fs.access(dbPath)).rejects.toThrow();
  });

  it('accepts every write as a silent no-op', async () => {
    const client = await GraphMemoryClient.create({ enabled: false });
    expect(() => {
      client.upsertEntity({ name: 'zora', kind: 'project' });
      client.recordTask({ jobId: 'j1', summary: 's', outcome: 'ok', ts: 1 }, [
        { name: 'zora', kind: 'project' },
      ]);
      client.recordDecision({ summary: 'd', rationale: 'r', ts: 1 }, 'j1', 'older');
      client.recordFailure({ tool: 'Bash', signature: 'sig', hint: 'h', ts: 1 }, 'j1');
      client.relateEntities({ name: 'a', kind: 'person' }, { name: 'b', kind: 'person' }, 'x');
    }).not.toThrow();
    await client.close();
  });

  it('answers every read with an empty result', async () => {
    const client = await GraphMemoryClient.create({ enabled: false });
    expect(await client.neighbours('zora')).toEqual([]);
    expect(await client.tasksMentioning('zora')).toEqual([]);
    expect(await client.relatedTasks('j1')).toEqual([]);
    expect(await client.decisionChain('d')).toEqual([]);
    expect(await client.failuresForTool('Bash')).toEqual([]);
    expect(await client.stats()).toEqual({ entities: 0, tasks: 0, decisions: 0, failures: 0 });
    await client.close();
  });

  it('tolerates close() being called more than once', async () => {
    const client = await GraphMemoryClient.create({ enabled: false });
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('degrades rather than hanging when the worker never reports readiness', async () => {
    // A pathological path: the worker cannot open the database, so it reports
    // unavailable. Boot must continue.
    const client = await GraphMemoryClient.create({
      enabled: true,
      path: '/proc/definitely/not/writable/graph.db',
      startupTimeoutMs: 4_000,
    });
    expect(client.available).toBe(false);
    expect(client.unavailableReason).toBeTruthy();
    expect(await client.stats()).toEqual({ entities: 0, tasks: 0, decisions: 0, failures: 0 });
    await client.close();
  }, 15_000);
});

describe('graph tools when the tier is inert', () => {
  it('exposes no tool at all, rather than one that always fails', async () => {
    const client = await GraphMemoryClient.create({ enabled: false });
    expect(createGraphTools(client)).toEqual([]);
    await client.close();
  });
});
