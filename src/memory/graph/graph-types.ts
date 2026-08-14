/**
 * Graph memory ontology and configuration types (MEM-30).
 *
 * The ontology is deliberately tiny. A graph tier only earns its place if the
 * relations it stores answer questions lexical search cannot; every extra node
 * kind is another thing the extraction pipeline has to populate correctly and
 * another way for the graph to fill with noise. Resist expanding this.
 *
 *   Nodes
 *     (:Entity   {name, kind})                       kind ∈ EntityKind
 *     (:Task     {jobId, summary, outcome, ts})
 *     (:Decision {summary, rationale, ts})
 *     (:Failure  {tool, signature, hint, ts})
 *
 *   Edges
 *     (:Task)-[:MENTIONS]->(:Entity)
 *     (:Task)-[:PRODUCED]->(:Decision)
 *     (:Task)-[:HIT]->(:Failure)
 *     (:Decision)-[:SUPERSEDES]->(:Decision)
 *     (:Entity)-[:RELATES_TO {relKind}]->(:Entity)
 *
 * Property names are unique across the whole ontology, not merely per label.
 * SparrowDB resolves a projected property by name rather than by the pattern
 * variable it was qualified with, so an edge property called `kind` alongside a
 * node property called `kind` reads back the node's value. Hence `relKind`.
 */

/** Node labels in the ontology. */
export const NODE_LABELS = ['Entity', 'Task', 'Decision', 'Failure'] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

/** Relationship types in the ontology. */
export const EDGE_TYPES = ['MENTIONS', 'PRODUCED', 'HIT', 'SUPERSEDES', 'RELATES_TO'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** The kinds of thing an `(:Entity)` may be. */
export const ENTITY_KINDS = ['person', 'project', 'tool', 'concept'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && (ENTITY_KINDS as readonly string[]).includes(value);
}

// ─── Record shapes ───────────────────────────────────────────────────

export interface EntityRecord {
  name: string;
  kind: EntityKind;
}

export interface TaskRecord {
  jobId: string;
  summary: string;
  /** Free-form outcome marker, e.g. 'success' | 'failure' | 'cancelled'. */
  outcome: string;
  /** Unix epoch milliseconds. */
  ts: number;
}

export interface DecisionRecord {
  summary: string;
  rationale: string;
  ts: number;
}

export interface FailureRecord {
  /** Tool that failed, e.g. 'Bash'. */
  tool: string;
  /** Stable, de-parameterized error signature used as the identity key. */
  signature: string;
  /** What to try instead. */
  hint: string;
  ts: number;
}

/** A single write applied to the graph. Writes are idempotent by construction. */
export type GraphWrite =
  | { op: 'upsertEntity'; entity: EntityRecord }
  | { op: 'recordTask'; task: TaskRecord; mentions?: EntityRecord[] }
  | { op: 'recordDecision'; decision: DecisionRecord; jobId?: string; supersedes?: string }
  | { op: 'recordFailure'; failure: FailureRecord; jobId?: string }
  | { op: 'relateEntities'; from: EntityRecord; to: EntityRecord; kind: string };

// ─── Query results ───────────────────────────────────────────────────

export interface NeighbourResult {
  name: string;
  kind: EntityKind | null;
  /** Relationship kind property, when traversing `RELATES_TO`. */
  relation: string | null;
  /** 'out' when the anchor points at the neighbour, 'in' when the reverse. */
  direction: 'out' | 'in';
}

export interface TaskResult {
  jobId: string;
  summary: string;
  outcome: string | null;
  ts: number | null;
  /** Entities that connected this task to the anchor, for two-hop results. */
  via?: string[];
}

export interface DecisionResult {
  summary: string;
  rationale: string | null;
  ts: number | null;
  /** Distance from the anchor decision along `SUPERSEDES`, 0 for the anchor. */
  depth: number;
}

export interface FailureResult {
  tool: string;
  signature: string;
  hint: string | null;
  ts: number | null;
}

export interface GraphStats {
  entities: number;
  tasks: number;
  decisions: number;
  failures: number;
}

// ─── Configuration ───────────────────────────────────────────────────

/**
 * Graph tier configuration.
 *
 * Defaults to OFF. The tier is opt-in because it depends on an optional native
 * module that is not available on every platform, and because a graph that is
 * never queried is pure write amplification.
 *
 * Not yet part of `ZoraConfig` — see the integration notes in the MEM-30
 * report. Until it is wired, `graphConfigFromEnv()` reads the environment.
 */
export interface GraphMemoryConfig {
  /** Master switch. Default false. */
  enabled: boolean;
  /** Directory for the SparrowDB database. */
  path: string;
  /** Flush queued writes after this many milliseconds. */
  flushIntervalMs: number;
  /** Flush immediately once this many writes are queued. */
  flushBatchSize: number;
  /** Checkpoint (fsync + compact) after this many flushes. */
  checkpointEveryFlushes: number;
  /** Hard cap on rows pulled from the engine before JS-side sorting. */
  maxRowsScanned: number;
  /** Milliseconds to wait for the worker to report readiness before degrading. */
  startupTimeoutMs: number;
  /** Milliseconds to wait for a single query before degrading to an empty result. */
  queryTimeoutMs: number;
}

export const DEFAULT_GRAPH_CONFIG: GraphMemoryConfig = {
  enabled: false,
  path: '~/.zora/memory/graph.db',
  flushIntervalMs: 250,
  flushBatchSize: 32,
  checkpointEveryFlushes: 20,
  maxRowsScanned: 500,
  startupTimeoutMs: 5_000,
  queryTimeoutMs: 10_000,
};

/**
 * Build a config from environment overrides, layered over the defaults.
 *
 * `ZORA_GRAPH_MEMORY=1` (or `true`/`on`) enables the tier;
 * `ZORA_GRAPH_MEMORY_PATH` overrides the database location.
 */
export function graphConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<GraphMemoryConfig> = {},
): GraphMemoryConfig {
  const flag = (env.ZORA_GRAPH_MEMORY ?? '').trim().toLowerCase();
  const enabled = flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes';
  return {
    ...DEFAULT_GRAPH_CONFIG,
    enabled,
    ...(env.ZORA_GRAPH_MEMORY_PATH ? { path: env.ZORA_GRAPH_MEMORY_PATH } : {}),
    ...overrides,
  };
}

// ─── Worker message protocol ─────────────────────────────────────────

/** Read-only operations the worker can serve. */
export type GraphQuery =
  | { op: 'neighbours'; name: string; limit: number }
  | { op: 'tasksMentioning'; name: string; limit: number }
  | { op: 'relatedTasks'; jobId: string; limit: number }
  | { op: 'decisionChain'; summary: string; limit: number }
  | { op: 'failuresForTool'; tool: string; limit: number }
  | { op: 'stats' };

export type GraphQueryResult =
  | { op: 'neighbours'; neighbours: NeighbourResult[] }
  | { op: 'tasksMentioning'; tasks: TaskResult[] }
  | { op: 'relatedTasks'; tasks: TaskResult[] }
  | { op: 'decisionChain'; decisions: DecisionResult[] }
  | { op: 'failuresForTool'; failures: FailureResult[] }
  | { op: 'stats'; stats: GraphStats };

/** Main thread → worker. */
export type WorkerRequest =
  | { id: number; kind: 'writes'; writes: GraphWrite[] }
  | { id: number; kind: 'query'; query: GraphQuery }
  | { id: number; kind: 'flush' }
  | { id: number; kind: 'close' };

/** Worker → main thread. */
export type WorkerResponse =
  | { kind: 'ready'; available: true }
  | { kind: 'ready'; available: false; reason: string }
  | { id: number; kind: 'ok'; result?: GraphQueryResult }
  | { id: number; kind: 'error'; message: string };
