/**
 * GraphMemoryClient tests — the worker-thread façade end to end.
 *
 * These spawn a real worker running a real SparrowDB. The point of the worker
 * is that the main thread never blocks on synchronous native calls, so the
 * suite measures that directly rather than asserting it in a comment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GraphMemoryClient } from '../../../../src/memory/graph/graph-memory-worker.js';
import { loadSparrow } from '../../../../src/memory/graph/sparrow-loader.js';

const sparrowAvailable = (await loadSparrow()).available;
const describeIfNative = (): typeof describe | typeof describe.skip =>
  sparrowAvailable ? describe : describe.skip;

/** Synchronous, main-thread cost of a call, in milliseconds. */
function blockMs(fn: () => unknown): number {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

describeIfNative()('GraphMemoryClient', () => {
  let tmpDir: string;
  let client: GraphMemoryClient;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-worker-'));
    client = await GraphMemoryClient.create({
      enabled: true,
      path: path.join(tmpDir, 'graph.db'),
      flushIntervalMs: 20,
      flushBatchSize: 16,
    });
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('starts and reports availability', () => {
    expect(client.available).toBe(true);
    expect(client.unavailableReason).toBeNull();
  });

  it('round-trips a write through the worker', async () => {
    client.recordTask({ jobId: 'job-1', summary: 'Deployed the API', outcome: 'success', ts: 5 }, [
      { name: 'zora', kind: 'project' },
    ]);

    const tasks = await client.tasksMentioning('zora');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ jobId: 'job-1', summary: 'Deployed the API' });
  });

  it('gives queries read-your-writes semantics without an explicit flush', async () => {
    // Writes are batched on the worker; a query must drain the queue first,
    // otherwise callers would need to know about the batching to use the API.
    for (let i = 0; i < 5; i++) {
      client.recordTask({ jobId: `job-${i}`, summary: `s${i}`, outcome: 'ok', ts: i }, [
        { name: 'zora', kind: 'project' },
      ]);
    }
    expect(await client.tasksMentioning('zora', 10)).toHaveLength(5);
  });

  it('answers a two-hop question through the worker', async () => {
    client.recordTask({ jobId: 'job-1', summary: 'Rotated the signing key', outcome: 'ok', ts: 1 }, [
      { name: 'zora', kind: 'project' },
    ]);
    client.recordTask({ jobId: 'job-2', summary: 'Bumped version numbers', outcome: 'ok', ts: 2 }, [
      { name: 'zora', kind: 'project' },
    ]);

    const related = await client.relatedTasks('job-1');
    expect(related.map(t => t.jobId)).toEqual(['job-2']);
  });

  it('walks a decision chain through the worker', async () => {
    client.recordDecision({ summary: 'Use flat files', rationale: 'simple', ts: 1 });
    client.recordDecision({ summary: 'Use SparrowDB', rationale: 'graph', ts: 2 }, undefined, 'Use flat files');

    const chain = await client.decisionChain('Use SparrowDB');
    expect(chain.map(d => d.summary)).toEqual(['Use SparrowDB', 'Use flat files']);
  });

  it('persists across a restart', async () => {
    client.recordTask({ jobId: 'job-1', summary: 'persisted', outcome: 'ok', ts: 1 }, [
      { name: 'zora', kind: 'project' },
    ]);
    await client.flush();
    await client.close();

    client = await GraphMemoryClient.create({
      enabled: true,
      path: path.join(tmpDir, 'graph.db'),
    });
    expect((await client.tasksMentioning('zora'))[0]?.summary).toBe('persisted');
  });

  it('reports stats', async () => {
    client.recordTask({ jobId: 'job-1', summary: 's', outcome: 'ok', ts: 1 }, [
      { name: 'zora', kind: 'project' },
    ]);
    client.recordFailure({ tool: 'Bash', signature: 'ENOENT', hint: 'check path', ts: 2 }, 'job-1');
    expect(await client.stats()).toMatchObject({ tasks: 1, entities: 1, failures: 1 });
  });

  it('becomes inert after close instead of throwing', async () => {
    await client.close();
    expect(client.available).toBe(false);
    expect(() => client.recordTask({ jobId: 'j', summary: 's', outcome: 'ok', ts: 1 })).not.toThrow();
    expect(await client.relatedTasks('j')).toEqual([]);
  });
});

describeIfNative()('GraphMemoryClient — main-thread cost', () => {
  let tmpDir: string;
  let client: GraphMemoryClient;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-perf-'));
    client = await GraphMemoryClient.create({
      enabled: true,
      path: path.join(tmpDir, 'graph.db'),
    });
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps every call under 5 ms of event-loop block on the main thread', async () => {
    // The same work done in-process would block for far longer: measured on
    // sparrowdb@0.1.21, a single one-hop query over 2k tasks takes ~53 ms of
    // synchronous native time, and an edge write ~16 ms. Off the worker, that
    // lands on the daemon's event loop.
    const writeBlocks: number[] = [];
    for (let i = 0; i < 200; i++) {
      writeBlocks.push(
        blockMs(() =>
          client.recordTask({ jobId: `job-${i}`, summary: `summary ${i}`, outcome: 'ok', ts: i }, [
            { name: `entity-${i % 20}`, kind: 'concept' },
          ]),
        ),
      );
    }

    const queryBlocks: number[] = [];
    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 20; i++) {
      queryBlocks.push(blockMs(() => promises.push(client.relatedTasks(`job-${i}`))));
    }
    await Promise.all(promises);

    const maxWrite = Math.max(...writeBlocks);
    const maxQuery = Math.max(...queryBlocks);
    const meanWrite = writeBlocks.reduce((a, b) => a + b, 0) / writeBlocks.length;

    // eslint-disable-next-line no-console
    console.log(
      `main-thread block — write: mean ${meanWrite.toFixed(3)}ms max ${maxWrite.toFixed(3)}ms ` +
        `over ${writeBlocks.length} calls; query dispatch: max ${maxQuery.toFixed(3)}ms`,
    );

    expect(maxWrite).toBeLessThan(5);
    expect(maxQuery).toBeLessThan(5);
  }, 60_000);

  it('starves the event loop far less than doing the same work in-process', async () => {
    // A comparative measurement rather than an absolute threshold: absolute
    // event-loop lag depends on core count and what else the machine is doing,
    // but the ratio between "same work on a worker" and "same work in-process"
    // is the property the worker actually buys and is stable across machines.
    const WRITES = 200;
    const write = (i: number): [{ jobId: string; summary: string; outcome: string; ts: number }, [{ name: string; kind: 'concept' }]] => [
      { jobId: `job-${i}`, summary: `summary ${i}`, outcome: 'ok', ts: i },
      [{ name: `entity-${i % 10}`, kind: 'concept' }],
    ];

    // Total synchronous main-thread time is the right metric here. A sampling
    // probe cannot measure the in-process case at all: the writes block the
    // loop so completely that a 5 ms interval never fires during them.
    let workerBlock = 0;
    for (let i = 0; i < WRITES; i++) workerBlock += blockMs(() => client.recordTask(...write(i)));
    await client.flush();

    const inlineDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-inline-'));
    const { GraphStore } = await import('../../../../src/memory/graph/graph-store.js');
    const inline = await GraphStore.open({ path: path.join(inlineDir, 'graph.db') });
    expect(inline).not.toBeNull();

    let inlineBlock = 0;
    for (let i = 0; i < WRITES; i++) inlineBlock += blockMs(() => inline!.recordTask(...write(i)));
    await fs.rm(inlineDir, { recursive: true, force: true });

    // eslint-disable-next-line no-console
    console.log(
      `main-thread block over ${WRITES} task writes — worker ${workerBlock.toFixed(1)}ms ` +
        `(${(workerBlock / WRITES).toFixed(3)}ms/call) vs in-process ${inlineBlock.toFixed(1)}ms ` +
        `(${(inlineBlock / WRITES).toFixed(3)}ms/call) — ${(inlineBlock / workerBlock).toFixed(0)}x`,
    );

    expect(workerBlock).toBeLessThan(inlineBlock / 20);
  }, 120_000);
});
