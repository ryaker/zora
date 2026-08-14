/**
 * GraphMemoryClient tests — the worker-thread façade end to end.
 *
 * These spawn a real worker running a real SparrowDB. The point of the worker
 * is that the main thread never blocks on synchronous native calls, so the
 * suite measures that directly rather than asserting it in a comment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performance } from 'node:perf_hooks';
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

/**
 * Counts main-thread event-loop turns.
 *
 * A `setInterval` callback can only run when the loop is free, so its tick
 * count is a direct, unit-free measure of "the daemon was still able to do
 * other things while this was happening" — which is the entire reason the
 * graph store lives on a worker.
 */
function heartbeat(intervalMs: number): { ticks: () => number; stop: () => void } {
  let n = 0;
  const timer = setInterval(() => {
    n++;
  }, intervalMs);
  return { ticks: () => n, stop: () => clearInterval(timer) };
}

/**
 * TEST-20 follow-up: hooks in this file open a worker, drain its write queue and
 * `rm -rf` a database directory — real, unbounded disk work. vitest's default
 * 10s `hookTimeout` is a fixed deadline in front of it, and under filesystem
 * contention it is the deadline that loses: an `npm install` running alongside
 * the suite made `afterEach` blow through 10s and reported both perf tests as
 * failures ("Hook timed out in 10000ms"), which is the flake this file was
 * filed for. Reproduced deterministically with 8 concurrent `dd`+fsync writers.
 */
const HOOK_TIMEOUT_MS = 120_000;

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
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

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
      // TEST-20 follow-up: these tests queue 200 writes in one batch, so the
      // worker's drain is a single multi-second native call. `queryTimeoutMs`
      // is a production guard against a wedged worker, not something this file
      // exercises — left at its 10s default it becomes a race against the disk,
      // and under contention `await client.flush()` below rejected with "graph
      // worker request 201 timed out" (reproduced: the same drain took 38s).
      queryTimeoutMs: 120_000,
    });
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

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
    // TEST-20 follow-up. This used to assert `workerBlock < inlineBlock / 20`.
    // Both halves are wall-clock sums, and `workerBlock` is tiny — under a
    // millisecond in total, spread over 200 samples — so a single scheduler
    // preemption landing inside any one sample inflates it by orders of
    // magnitude while leaving the multi-second in-process half essentially
    // unchanged. The ratio is not a stable property of the code; it is a
    // property of how quiet the machine was. Same conclusion TEST-20 reached on
    // the cross-agent benchmark: anything that numerically distinguishes "cost
    // paid here" from "cost paid on another thread" *is* a stopwatch, so the
    // stopwatch is reported and the property is asserted instead.
    //
    // The property: while the same 200 writes are being applied, the main
    // thread's event loop keeps turning. A `setInterval` tick can only happen
    // when the loop is free, so counting ticks measures exactly that, and load
    // pushes the count up (more wall time to tick in), never down — the failure
    // direction is the one that matters.
    const WRITES = 200;
    const HEARTBEAT_MS = 5;
    const write = (i: number): [{ jobId: string; summary: string; outcome: string; ts: number }, [{ name: string; kind: 'concept' }]] => [
      { jobId: `job-${i}`, summary: `summary ${i}`, outcome: 'ok', ts: i },
      [{ name: `entity-${i % 10}`, kind: 'concept' }],
    ];

    // ── Through the worker ────────────────────────────────────────────
    // Issuing the writes costs only postMessage; the database work happens on
    // the worker while the main thread sits in the `await` below.
    const workerBeat = heartbeat(HEARTBEAT_MS);
    const eluBefore = performance.eventLoopUtilization();
    const workerStart = performance.now();
    let workerBlock = 0;
    for (let i = 0; i < WRITES; i++) workerBlock += blockMs(() => client.recordTask(...write(i)));
    await client.flush();
    const workerWall = performance.now() - workerStart;
    // Fraction of this phase during which the main thread's loop was busy
    // rather than parked in poll. Numerator and denominator are measured over
    // the same interval, so a scheduler stall inflates both and the ratio holds
    // — which is exactly what the old cross-phase ratio could not do.
    const workerUtilization = performance.eventLoopUtilization(eluBefore).utilization;
    workerBeat.stop();
    const workerTicks = workerBeat.ticks();

    // Not vacuous: the writes really were applied, and applied over there.
    expect((await client.stats()).tasks).toBe(WRITES);

    // ── The same work in-process, as the control ──────────────────────
    const inlineDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-inline-'));
    const { GraphStore } = await import('../../../../src/memory/graph/graph-store.js');
    const inline = await GraphStore.open({ path: path.join(inlineDir, 'graph.db') });
    expect(inline).not.toBeNull();

    const inlineBeat = heartbeat(HEARTBEAT_MS);
    const inlineEluBefore = performance.eventLoopUtilization();
    const inlineStart = performance.now();
    let inlineBlock = 0;
    for (let i = 0; i < WRITES; i++) inlineBlock += blockMs(() => inline!.recordTask(...write(i)));
    inline!.checkpoint();
    const inlineWall = performance.now() - inlineStart;
    const inlineUtilization = performance.eventLoopUtilization(inlineEluBefore).utilization;
    inlineBeat.stop();
    const inlineTicks = inlineBeat.ticks();
    await fs.rm(inlineDir, { recursive: true, force: true });

    // Reported, never asserted: on an idle box this is ~1000x, and under disk
    // contention it grows rather than shrinks (measured 45680x with eight
    // concurrent fsync writers), but a stray preemption can move it either way.
    // eslint-disable-next-line no-console
    console.log(
      `over ${WRITES} task writes — worker: ${workerBlock.toFixed(1)}ms blocked ` +
        `(${(workerBlock / WRITES).toFixed(3)}ms/call) of ${workerWall.toFixed(0)}ms wall, ` +
        `loop utilization ${workerUtilization.toFixed(3)}, ${workerTicks} heartbeat ticks; ` +
        `in-process: ${inlineBlock.toFixed(1)}ms blocked (${(inlineBlock / WRITES).toFixed(3)}ms/call) ` +
        `of ${inlineWall.toFixed(0)}ms wall, loop utilization ${inlineUtilization.toFixed(3)}, ` +
        `${inlineTicks} heartbeat ticks — ${(inlineBlock / workerBlock).toFixed(0)}x`,
    );

    // The property, in two independent forms.
    //
    // 1. The loop was mostly *free* while the writes were applied. Measured
    //    ~0.01 through the worker and ~0.84 with the work moved back onto the
    //    calling thread, so 0.5 sits an order of magnitude clear of the real
    //    value and still catches the regression. Because utilization is
    //    normalized by the phase's own wall time, a stall inflates both halves
    //    and leaves it where it was.
    // 2. The loop actually turned. A count of zero would mean the phase was one
    //    unbroken synchronous block, however long it took. This is the weaker
    //    of the two — a mutant that merely *adds* main-thread work still leaves
    //    the worker's own drain to tick through — so it guards vacuity rather
    //    than carrying the test.
    expect(workerUtilization).toBeLessThan(0.5);
    expect(workerTicks).toBeGreaterThan(10);
  }, 180_000);
});
