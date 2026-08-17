/**
 * Graph memory worker (MEM-30).
 *
 * `SparrowDB.execute()` is synchronous native code with no indexes: every
 * property lookup is a full scan. Measured on sparrowdb@0.1.21 with 2,000 Task
 * nodes and 2,000 edges:
 *
 *     CREATE (:Task {...})            p50   1.1 ms
 *     MATCH two endpoints + CREATE    p50  16.2 ms
 *     one-hop MATCH … RETURN          p50  52.7 ms
 *     two-hop MATCH … RETURN          p50  27.2 ms
 *     checkpoint()                          94   ms
 *
 * Those numbers are per call and grow with graph size. Running them on the main
 * thread of a long-running daemon would stall event streaming, the dashboard
 * SSE feed and provider I/O for tens of milliseconds at a time. So the store
 * lives on a worker thread and the main thread only ever pays the cost of a
 * `postMessage` (measured at well under 1 ms).
 *
 * This file is both the worker entry point and the main-thread client. It is
 * self-hosting: the client spawns `new Worker(import.meta.url)`, and the module
 * decides which half to run based on `isMainThread`.
 *
 * Structure mirrors `src/memory/reflector-worker.ts`: a plain class with an
 * injectable dependency, degrading to a no-op on failure rather than throwing.
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { buildTypeScriptBootstrap } from './worker-bootstrap.js';
import { GraphStore } from './graph-store.js';
import {
  DEFAULT_GRAPH_CONFIG,
  type DecisionRecord,
  type DecisionResult,
  type EntityRecord,
  type FailureRecord,
  type FailureResult,
  type GraphMemoryConfig,
  type GraphQuery,
  type GraphQueryResult,
  type GraphStats,
  type GraphWrite,
  type NeighbourResult,
  type TaskRecord,
  type TaskResult,
  type WorkerRequest,
  type WorkerResponse,
} from './graph-types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('graph-memory-worker');

/** Marker in `workerData` so an unrelated worker never runs this entry point. */
const GRAPH_WORKER_TAG = 'zora-graph-memory-worker/1';

interface GraphWorkerData {
  tag: typeof GRAPH_WORKER_TAG;
  path: string;
  flushIntervalMs: number;
  flushBatchSize: number;
  checkpointEveryFlushes: number;
  maxRowsScanned: number;
}

const EMPTY_STATS: GraphStats = { entities: 0, tasks: 0, decisions: 0, failures: 0 };

// ═══════════════════════════════════════════════════════════════════
// Worker half
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the worker loop. Called only inside a worker thread.
 *
 * Writes are queued and applied in batches so a burst of extraction output
 * costs one drain rather than N native round trips interleaved with message
 * handling. Queries drain the queue first, giving read-your-writes semantics
 * that callers (and tests) can rely on.
 */
async function runWorker(port: NonNullable<typeof parentPort>, data: GraphWorkerData): Promise<void> {
  const store = await GraphStore.open({
    path: data.path,
    maxRowsScanned: data.maxRowsScanned,
  });

  if (!store) {
    const response: WorkerResponse = {
      kind: 'ready',
      available: false,
      reason: 'sparrowdb unavailable or database could not be opened',
    };
    port.postMessage(response);
    return;
  }

  let queue: GraphWrite[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let flushCount = 0;

  const drain = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    store.applyWrites(batch);
    flushCount++;
    if (flushCount % data.checkpointEveryFlushes === 0) {
      store.checkpoint();
    }
  };

  const scheduleFlush = (): void => {
    if (queue.length >= data.flushBatchSize) {
      drain();
      return;
    }
    if (flushTimer) return;
    flushTimer = setTimeout(drain, data.flushIntervalMs);
    // Do not hold the worker's event loop open purely for a pending flush.
    flushTimer.unref?.();
  };

  const runQuery = (query: GraphQuery): GraphQueryResult => {
    drain(); // read-your-writes
    switch (query.op) {
      case 'neighbours':
        return { op: 'neighbours', neighbours: store.neighbours(query.name, query.limit) };
      case 'tasksMentioning':
        return { op: 'tasksMentioning', tasks: store.tasksMentioning(query.name, query.limit) };
      case 'relatedTasks':
        return { op: 'relatedTasks', tasks: store.relatedTasks(query.jobId, query.limit) };
      case 'decisionChain':
        return { op: 'decisionChain', decisions: store.decisionChain(query.summary, query.limit) };
      case 'failuresForTool':
        return { op: 'failuresForTool', failures: store.failuresForTool(query.tool, query.limit) };
      case 'stats':
        return { op: 'stats', stats: store.stats() };
    }
  };

  port.on('message', (request: WorkerRequest) => {
    try {
      switch (request.kind) {
        case 'writes':
          // Deliberately unacknowledged. An ack per write would double the
          // message traffic and put one promise resolution on the main thread
          // for every fact recorded, to report something no caller acts on:
          // per-write failures are already logged worker-side by applyWrites,
          // and `flush()` provides the synchronization point when one is
          // needed. Queries drain the queue first, so nothing is lost.
          queue.push(...request.writes);
          scheduleFlush();
          break;
        case 'query': {
          const result = runQuery(request.query);
          port.postMessage({ id: request.id, kind: 'ok', result } satisfies WorkerResponse);
          break;
        }
        case 'flush':
          drain();
          store.checkpoint();
          port.postMessage({ id: request.id, kind: 'ok' } satisfies WorkerResponse);
          break;
        case 'close':
          drain();
          store.checkpoint();
          // Checkpoint first, then hand the database root back (MEM-35): the
          // lock is what stops the next `zora-agent` process from opening a
          // database this one is still writing to.
          store.close();
          port.postMessage({ id: request.id, kind: 'ok' } satisfies WorkerResponse);
          port.close();
          break;
      }
    } catch (err) {
      port.postMessage({
        id: request.id,
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
  });

  port.postMessage({ kind: 'ready', available: true } satisfies WorkerResponse);
}

if (!isMainThread && parentPort && (workerData as GraphWorkerData | null)?.tag === GRAPH_WORKER_TAG) {
  void runWorker(parentPort, workerData as GraphWorkerData);
}

// ═══════════════════════════════════════════════════════════════════
// Main-thread half
// ═══════════════════════════════════════════════════════════════════

/**
 * A request without its correlation id.
 *
 * Written as a distributive conditional rather than `Omit<WorkerRequest, 'id'>`
 * because a plain `Omit` over a union collapses to the union's common members
 * and would erase the `query` field.
 */
type WorkerRequestBody = WorkerRequest extends infer T
  ? T extends WorkerRequest
    ? Omit<T, 'id'>
    : never
  : never;

interface Pending {
  resolve: (result?: GraphQueryResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Main-thread façade over the graph worker.
 *
 * Every method is safe to call on an unavailable tier: writes become no-ops and
 * reads return empty results. Callers never need to check availability first,
 * though `available` is exposed so a tool can describe itself honestly.
 */
export class GraphMemoryClient {
  private readonly _config: GraphMemoryConfig;
  private _worker: Worker | null = null;
  private _available = false;
  private _unavailableReason: string | null = null;
  private _nextId = 1;
  private readonly _pending = new Map<number, Pending>();
  private _closed = false;

  private constructor(config: GraphMemoryConfig) {
    this._config = config;
  }

  /**
   * Start the graph tier.
   *
   * Never throws and never blocks boot beyond `startupTimeoutMs`. A disabled
   * flag, a missing native module, a spawn failure and a startup timeout all
   * produce the same thing: an inert client that the rest of Zora can call
   * freely.
   */
  static async create(config: Partial<GraphMemoryConfig> = {}): Promise<GraphMemoryClient> {
    const merged: GraphMemoryConfig = { ...DEFAULT_GRAPH_CONFIG, ...config };
    const client = new GraphMemoryClient(merged);

    if (!merged.enabled) {
      client._unavailableReason = 'graph memory is disabled by configuration';
      log.debug('Graph memory tier disabled by configuration');
      return client;
    }

    try {
      await client._spawn();
    } catch (err) {
      client._available = false;
      client._unavailableReason = err instanceof Error ? err.message : String(err);
      log.warn(
        { reason: client._unavailableReason },
        'Graph memory tier failed to start — continuing without relational recall',
      );
    }
    return client;
  }

  /** Whether the tier is live. `false` means every call is an inert no-op. */
  get available(): boolean {
    return this._available;
  }

  /** Why the tier is inert, or null when it is live. */
  get unavailableReason(): string | null {
    return this._unavailableReason;
  }

  // ── Writes (fire-and-forget) ──────────────────────────────────────

  upsertEntity(entity: EntityRecord): void {
    this._write({ op: 'upsertEntity', entity });
  }

  recordTask(task: TaskRecord, mentions: EntityRecord[] = []): void {
    this._write({ op: 'recordTask', task, mentions });
  }

  recordDecision(decision: DecisionRecord, jobId?: string, supersedes?: string): void {
    this._write({
      op: 'recordDecision',
      decision,
      ...(jobId ? { jobId } : {}),
      ...(supersedes ? { supersedes } : {}),
    });
  }

  recordFailure(failure: FailureRecord, jobId?: string): void {
    this._write({ op: 'recordFailure', failure, ...(jobId ? { jobId } : {}) });
  }

  relateEntities(from: EntityRecord, to: EntityRecord, kind: string): void {
    this._write({ op: 'relateEntities', from, to, kind });
  }

  // ── Reads ─────────────────────────────────────────────────────────

  async neighbours(name: string, limit = 20): Promise<NeighbourResult[]> {
    const r = await this._query({ op: 'neighbours', name, limit });
    return r?.op === 'neighbours' ? r.neighbours : [];
  }

  async tasksMentioning(name: string, limit = 10): Promise<TaskResult[]> {
    const r = await this._query({ op: 'tasksMentioning', name, limit });
    return r?.op === 'tasksMentioning' ? r.tasks : [];
  }

  async relatedTasks(jobId: string, limit = 10): Promise<TaskResult[]> {
    const r = await this._query({ op: 'relatedTasks', jobId, limit });
    return r?.op === 'relatedTasks' ? r.tasks : [];
  }

  async decisionChain(summary: string, limit = 10): Promise<DecisionResult[]> {
    const r = await this._query({ op: 'decisionChain', summary, limit });
    return r?.op === 'decisionChain' ? r.decisions : [];
  }

  async failuresForTool(tool: string, limit = 10): Promise<FailureResult[]> {
    const r = await this._query({ op: 'failuresForTool', tool, limit });
    return r?.op === 'failuresForTool' ? r.failures : [];
  }

  async stats(): Promise<GraphStats> {
    const r = await this._query({ op: 'stats' });
    return r?.op === 'stats' ? r.stats : EMPTY_STATS;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /** Apply all queued writes and checkpoint. Resolves immediately when inert. */
  async flush(): Promise<void> {
    if (!this._available) return;
    await this._send({ kind: 'flush' });
  }

  /** Flush, checkpoint, and terminate the worker. Idempotent. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    if (!this._worker) return;

    try {
      await this._send({ kind: 'close' });
    } catch {
      // Worker may already be gone; termination below is the backstop.
    }
    this._available = false;
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    this._pending.clear();
    await this._worker.terminate();
    this._worker = null;
  }

  // ── Internals ─────────────────────────────────────────────────────

  private _spawn(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry = fileURLToPath(import.meta.url);
      const data: GraphWorkerData = {
        tag: GRAPH_WORKER_TAG,
        path: this._config.path,
        flushIntervalMs: this._config.flushIntervalMs,
        flushBatchSize: this._config.flushBatchSize,
        checkpointEveryFlushes: this._config.checkpointEveryFlushes,
        maxRowsScanned: this._config.maxRowsScanned,
      };

      // In a built install the entry is plain JavaScript and the worker needs
      // nothing special. Running from source (tsx, vitest) it is TypeScript, so
      // an eval'd bootstrap loads it — see worker-bootstrap.ts for why the
      // obvious `execArgv: ['--import','tsx']` does not work.
      let settled = false;
      const worker = entry.endsWith('.ts')
        ? (() => {
            const bootstrap = buildTypeScriptBootstrap(import.meta.url);
            return new Worker(bootstrap.source, {
              eval: true,
              workerData: { ...data, ...bootstrap.workerData },
            });
          })()
        : new Worker(entry, { workerData: data });
      this._worker = worker;

      const startupTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._available = false;
        this._unavailableReason = 'graph worker did not report readiness in time';
        void worker.terminate();
        this._worker = null;
        reject(new Error(this._unavailableReason));
      }, this._config.startupTimeoutMs);
      startupTimer.unref?.();

      worker.on('message', (response: WorkerResponse) => {
        if (response.kind === 'ready') {
          if (settled) return;
          settled = true;
          clearTimeout(startupTimer);
          if (response.available) {
            this._available = true;
            this._updateRef();
            log.info({ path: this._config.path }, 'Graph memory tier ready');
            resolve();
          } else {
            this._available = false;
            this._unavailableReason = response.reason;
            void worker.terminate();
            this._worker = null;
            reject(new Error(response.reason));
          }
          return;
        }
        this._settle(response);
      });

      worker.on('error', err => {
        this._available = false;
        this._unavailableReason = err.message;
        this._failAllPending(err);
        if (settled) {
          log.warn({ err }, 'Graph worker errored — graph memory tier is now inert');
          return;
        }
        settled = true;
        clearTimeout(startupTimer);
        this._worker = null;
        reject(err);
      });

      worker.on('exit', code => {
        this._available = false;
        this._failAllPending(new Error(`graph worker exited with code ${code}`));
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        this._worker = null;
        reject(new Error(`graph worker exited during startup with code ${code}`));
      });
    });
  }

  /**
   * Keep the worker referenced only while a request is outstanding.
   *
   * An idle graph worker must not hold the daemon's event loop open at
   * shutdown, but an unreferenced worker with a pending query would let the
   * process exit before the answer arrives.
   */
  private _updateRef(): void {
    if (!this._worker) return;
    if (this._pending.size > 0) this._worker.ref();
    else this._worker.unref();
  }

  private _settle(response: WorkerResponse): void {
    if (!('id' in response)) return;
    const pending = this._pending.get(response.id);
    if (!pending) return;
    this._pending.delete(response.id);
    clearTimeout(pending.timer);
    this._updateRef();
    if (response.kind === 'error') {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private _failAllPending(err: Error): void {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this._pending.clear();
    this._updateRef();
  }

  /**
   * Enqueue a write.
   *
   * Costs exactly one `postMessage` — measured at well under 0.2 ms — and
   * nothing else: no promise, no timer, no ack. Recording a fact must never be
   * something a caller has to await or handle the failure of.
   */
  private _write(write: GraphWrite): void {
    if (!this._available || !this._worker) return;
    this._worker.postMessage({
      id: this._nextId++,
      kind: 'writes',
      writes: [write],
    } satisfies WorkerRequest);
  }

  private async _query(query: GraphQuery): Promise<GraphQueryResult | undefined> {
    if (!this._available || !this._worker) return undefined;
    try {
      return await this._send({ kind: 'query', query });
    } catch (err) {
      log.debug({ err, op: query.op }, 'Graph query failed; returning empty result');
      return undefined;
    }
  }

  private _send(request: WorkerRequestBody): Promise<GraphQueryResult | undefined> {
    const worker = this._worker;
    if (!worker) return Promise.resolve(undefined);
    const id = this._nextId++;
    const promise = this._track(id);
    worker.postMessage({ ...request, id } as WorkerRequest);
    return promise;
  }

  private _track(id: number): Promise<GraphQueryResult | undefined> {
    return new Promise<GraphQueryResult | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        this._updateRef();
        reject(new Error(`graph worker request ${id} timed out`));
      }, this._config.queryTimeoutMs);
      timer.unref?.();
      this._pending.set(id, { resolve, reject, timer });
      this._updateRef();
    });
  }
}
