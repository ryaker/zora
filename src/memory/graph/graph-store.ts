/**
 * GraphStore — typed adapter over the `sparrowdb` embedded graph (MEM-30).
 *
 * This class exists to make SparrowDB's 0.1.x Cypher dialect a private detail.
 * Nothing above it should ever assemble a query string. The quirks it hides,
 * all verified against sparrowdb@0.1.21:
 *
 *   1. **No parameter binding, and injection is real.** Every value is
 *      interpolated, so every value goes through `src/memory/graph/cypher.ts`
 *      first. That module is the security boundary; see its header. This is not
 *      theoretical: interpolating `", role: "admin` into a `CREATE` property
 *      map has been reproduced adding an unintended `role` property, and
 *      `" OR n.name <> "` has been reproduced subverting a `WHERE` predicate.
 *      Statement chaining currently fails only because multi-clause statements
 *      are unimplemented — an accident of incompleteness, not a boundary.
 *      `$param` placeholders are worse than useless: they are **silently
 *      ignored**, so `MATCH (n:Person {name: $name})` returns *every* Person.
 *      Never emit `$`-prefixed placeholder syntax from this file.
 *   2. **No transactions.** `ReadTx.execute()` / `WriteTx.execute()` throw
 *      (upstream SPA-99 / SPA-100), so all access goes through
 *      `SparrowDB.execute()`, which auto-commits per statement. There is no
 *      multi-statement atomicity, so every write here is idempotent and safe to
 *      replay: a crash between two statements leaves a partial but valid graph.
 *   3. **One clause per statement.** `CREATE … CREATE …` is a parse error, and
 *      a second `MATCH` clause is a parse error. Edge creation must therefore
 *      use the comma form: `MATCH (a:X {…}), (b:Y {…}) CREATE (a)-[:R]->(b)`.
 *      `MATCH … WHERE … CREATE …` is *also* a parse error, so edge endpoints
 *      must be selected by inline property maps only.
 *   4. **`RETURN n` is unusable.** Returning a whole node yields a map keyed by
 *      hashed column names (`col_2369371622`), not the documented
 *      `{$type:'node', id}` ref. Every read here returns explicit properties.
 *   5. **`ORDER BY` on numeric properties does not sort.** Verified: five Task
 *      nodes with distinct `ts` came back in insertion order. All ordering is
 *      therefore done in JavaScript after a capped scan, and `LIMIT` is applied
 *      here rather than in the engine (an engine-side LIMIT over an unsorted
 *      scan truncates the wrong rows).
 *   6. **No indexes.** Property lookups are full scans; measured cost grows
 *      linearly with graph size (≈50 ms for a one-hop query at 2k tasks). This
 *      is why the store runs on a worker thread — see graph-memory-worker.ts.
 *   7. **Edges are append-only.** `MATCH (a)-[r:R]->(b) SET r.x = …` fails with
 *      "supports only single-node patterns", and there is no `DETACH DELETE` or
 *      `REMOVE`. Edge properties are therefore written once, at MERGE time, and
 *      never mutated. The ontology is designed so nothing here ever needs to:
 *      a superseded decision gets a new `SUPERSEDES` edge rather than an edited
 *      one. Node properties *can* be updated, but only through a single-node
 *      `MATCH … SET`, which is what every writer below uses.
 *   8. **Arrow direction is ignored in a single-hop pattern.** `(a)<-[r:R]-(b)`
 *      returns the same rows as `(a)-[r:R]->(b)`; the left variable is always
 *      the edge source. Inbound queries put the anchor on the right instead.
 *   9. **`DISTINCT` and untyped variable-length paths are unsupported.**
 *      Deduplication happens in JavaScript, and the supersession chain is
 *      walked one hop at a time rather than with `[*1..n]`.
 *  10. **`null` and array property values are rejected at CREATE.** Optional
 *      fields are omitted rather than nulled, and only strings and numbers are
 *      ever written. Booleans are avoided entirely: they round-trip as 1/0 and
 *      become indistinguishable from integers on read.
 *
 * Missing labels and relationship types are not errors: a pattern over a label
 * that has never been written returns zero rows.
 */

import {
  escapeValue,
  formatPropertyMap,
  nodePattern,
  validateIdentifier,
  type PropertyValue,
} from './cypher.js';
import type { SparrowDatabase, SparrowModule } from './sparrow-loader.js';
import { loadSparrow } from './sparrow-loader.js';
import {
  isEntityKind,
  type DecisionRecord,
  type DecisionResult,
  type EntityKind,
  type EntityRecord,
  type FailureRecord,
  type FailureResult,
  type GraphStats,
  type GraphWrite,
  type NeighbourResult,
  type TaskRecord,
  type TaskResult,
} from './graph-types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('graph-store');

/** Longest string we let into a node property. Summaries are LLM-generated. */
const MAX_PROP_LENGTH = 2000;

export interface GraphStoreOptions {
  /** Filesystem path for the database directory. */
  path: string;
  /** Hard cap on rows pulled from the engine before JS-side sort + slice. */
  maxRowsScanned?: number;
  /** Injectable module, for tests. Defaults to the lazily-loaded `sparrowdb`. */
  module?: SparrowModule;
}

/**
 * A synchronous, single-threaded adapter over one SparrowDB database.
 *
 * Instances are cheap to construct but `open()` is the only entry point,
 * because a store that could not load its native module must be representable
 * as `null` rather than as a half-built object that throws on first use.
 */
export class GraphStore {
  private readonly _db: SparrowDatabase;
  private readonly _maxRows: number;

  private constructor(db: SparrowDatabase, maxRows: number) {
    this._db = db;
    this._maxRows = maxRows;
  }

  /**
   * Open (or create) a graph database.
   *
   * @returns A store, or `null` when `sparrowdb` is unavailable or the database
   *   cannot be opened. Callers must treat `null` as "graph tier is inert" and
   *   continue without it.
   */
  static async open(options: GraphStoreOptions): Promise<GraphStore | null> {
    let mod = options.module;
    if (!mod) {
      const loaded = await loadSparrow();
      if (!loaded.available) return null;
      mod = loaded.module;
    }

    try {
      const db = mod.SparrowDB.open(options.path);
      return new GraphStore(db, options.maxRowsScanned ?? 500);
    } catch (err) {
      log.warn(
        { err, path: options.path },
        'Failed to open graph database — graph memory tier is inert',
      );
      return null;
    }
  }

  // ── Writes ────────────────────────────────────────────────────────
  //
  // Every write is idempotent: re-applying it produces the same graph. This is
  // the only durability story available without transactions.

  /** Create the entity if it does not already exist, updating its kind if it does. */
  upsertEntity(entity: EntityRecord): void {
    const name = clamp(entity.name);
    if (!name) return;
    const kind: EntityKind = isEntityKind(entity.kind) ? entity.kind : 'concept';
    this._upsertNode('Entity', { name }, { kind });
  }

  /**
   * Record a completed task, optionally linking the entities it mentioned.
   *
   * `jobId` is the identity key: re-recording the same job updates the node in
   * place and re-MERGEs the same `MENTIONS` edges, which is a no-op. Replaying
   * a task is safe — the property the design leans on, since there are no
   * transactions to make a multi-statement write atomic.
   */
  recordTask(task: TaskRecord, mentions: EntityRecord[] = []): void {
    const jobId = clamp(task.jobId, 200);
    if (!jobId) return;

    this._upsertNode(
      'Task',
      { jobId },
      {
        summary: clamp(task.summary),
        outcome: clamp(task.outcome, 100),
        ts: safeTs(task.ts),
      },
    );

    for (const entity of mentions) {
      const name = clamp(entity.name);
      if (!name) continue;
      this.upsertEntity(entity);
      this._link('Task', { jobId }, 'MENTIONS', 'Entity', { name });
    }
  }

  /**
   * Record a decision, optionally attributing it to a task and marking the
   * decision it supersedes.
   *
   * `summary` is the identity key — decisions are deduplicated by their text.
   */
  recordDecision(decision: DecisionRecord, jobId?: string, supersedes?: string): void {
    const summary = clamp(decision.summary);
    if (!summary) return;

    this._upsertNode(
      'Decision',
      { summary },
      { rationale: clamp(decision.rationale), ts: safeTs(decision.ts) },
    );

    if (jobId) {
      this._link('Task', { jobId: clamp(jobId, 200) }, 'PRODUCED', 'Decision', { summary });
    }
    if (supersedes) {
      const older = clamp(supersedes);
      // Only link to a decision that already exists; creating a placeholder
      // would pollute the chain with an empty node.
      if (older && this._exists('Decision', { summary: older })) {
        this._link('Decision', { summary }, 'SUPERSEDES', 'Decision', { summary: older });
      }
    }
  }

  /**
   * Record a tool failure, optionally attributing it to a task.
   *
   * `signature` is the identity key, so repeated occurrences of the same error
   * collapse onto one node and accumulate `HIT` edges from different tasks —
   * which is exactly the shape that makes "has this failed before?" answerable.
   */
  recordFailure(failure: FailureRecord, jobId?: string): void {
    const signature = clamp(failure.signature, 500);
    if (!signature) return;

    this._upsertNode(
      'Failure',
      { signature },
      {
        tool: clamp(failure.tool, 100),
        hint: clamp(failure.hint),
        ts: safeTs(failure.ts),
      },
    );

    if (jobId) {
      this._link('Task', { jobId: clamp(jobId, 200) }, 'HIT', 'Failure', { signature });
    }
  }

  /** Relate two entities, creating either endpoint if needed. */
  relateEntities(from: EntityRecord, to: EntityRecord, kind: string): void {
    const fromName = clamp(from.name);
    const toName = clamp(to.name);
    if (!fromName || !toName || fromName === toName) return;

    this.upsertEntity(from);
    this.upsertEntity(to);
    // The edge property is `relKind`, not `kind`, deliberately. Verified
    // against sparrowdb@0.1.21: when an edge property and a node property share
    // a name, projecting both in one RETURN resolves the edge's value to the
    // node's — `RETURN b.kind, r.kind` yields the node's kind twice. Property
    // names must be unique across the whole ontology, not just per label.
    this._link('Entity', { name: fromName }, 'RELATES_TO', 'Entity', { name: toName }, {
      relKind: clamp(kind, 100),
    });
  }

  /** Apply a batch of writes. Individual failures are logged, not thrown. */
  applyWrites(writes: GraphWrite[]): void {
    for (const write of writes) {
      try {
        switch (write.op) {
          case 'upsertEntity':
            this.upsertEntity(write.entity);
            break;
          case 'recordTask':
            this.recordTask(write.task, write.mentions ?? []);
            break;
          case 'recordDecision':
            this.recordDecision(write.decision, write.jobId, write.supersedes);
            break;
          case 'recordFailure':
            this.recordFailure(write.failure, write.jobId);
            break;
          case 'relateEntities':
            this.relateEntities(write.from, write.to, write.kind);
            break;
        }
      } catch (err) {
        log.debug({ err, op: write.op }, 'Graph write failed; skipping');
      }
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────

  /**
   * Entities directly connected to `name` via `RELATES_TO`, in both directions.
   *
   * Two queries, one per direction, and *both use a left-to-right arrow*.
   * Verified against sparrowdb@0.1.21: the arrow direction written in a
   * single-hop pattern is ignored — `(a)<-[r:R]-(b)` returns exactly the same
   * rows as `(a)-[r:R]->(b)`, because the planner always binds the left
   * variable to the edge source and the right variable to the target. The only
   * way to ask for inbound edges is to move the anchor to the right-hand side.
   *
   * The undirected form `(a)-[r:R]-(b)` does traverse both ways, but drops the
   * edge properties on the reverse leg (`r.kind` comes back null), so it is not
   * usable here.
   */
  neighbours(name: string, limit = 20): NeighbourResult[] {
    const anchor = clamp(name);
    if (!anchor) return [];

    const out = this._query(
      `MATCH ${nodePattern('a', 'Entity', { name: anchor })}-[r:RELATES_TO]->${nodePattern('b', 'Entity')} ` +
        `RETURN b.name, b.kind, r.relKind LIMIT ${this._maxRows}`,
    );
    const inbound = this._query(
      `MATCH ${nodePattern('b', 'Entity')}-[r:RELATES_TO]->${nodePattern('a', 'Entity', { name: anchor })} ` +
        `RETURN b.name, b.kind, r.relKind LIMIT ${this._maxRows}`,
    );

    const seen = new Set<string>();
    const results: NeighbourResult[] = [];
    for (const [rows, direction] of [
      [out, 'out'],
      [inbound, 'in'],
    ] as const) {
      for (const row of rows) {
        const neighbourName = str(row['b.name']);
        if (!neighbourName) continue;
        const key = `${direction}:${neighbourName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = str(row['b.kind']);
        results.push({
          name: neighbourName,
          kind: isEntityKind(kind) ? kind : null,
          relation: str(row['r.relKind']),
          direction,
        });
      }
    }
    return results.slice(0, limit);
  }

  /** Tasks that mention `name`, most recent first. */
  tasksMentioning(name: string, limit = 10): TaskResult[] {
    const anchor = clamp(name);
    if (!anchor) return [];

    const rows = this._query(
      `MATCH ${nodePattern('t', 'Task')}-[:MENTIONS]->${nodePattern('e', 'Entity', { name: anchor })} ` +
        `RETURN t.jobId, t.summary, t.outcome, t.ts LIMIT ${this._maxRows}`,
    );
    return sortByTsDesc(dedupeTasks(rows)).slice(0, limit);
  }

  /**
   * Two-hop traversal: other tasks that mention any entity this task mentions.
   *
   * This is the query BM25 cannot answer. Lexical search over task summaries
   * finds tasks whose *words* overlap; this finds tasks that touch the same
   * *things*, even when the summaries share no vocabulary at all.
   *
   * The self-match (`o` = the anchor task) is filtered in JavaScript rather
   * than with `WHERE o.jobId <> t.jobId`, because the anchor is already pinned
   * by an inline property map and a literal comparison is cheaper than making
   * the engine evaluate a variable-to-variable predicate over the scan.
   */
  relatedTasks(jobId: string, limit = 10): TaskResult[] {
    const anchor = clamp(jobId, 200);
    if (!anchor) return [];

    const rows = this._query(
      `MATCH ${nodePattern('t', 'Task', { jobId: anchor })}-[:MENTIONS]->${nodePattern('e', 'Entity')}` +
        `<-[:MENTIONS]-${nodePattern('o', 'Task')} ` +
        `RETURN o.jobId, o.summary, o.outcome, o.ts, e.name LIMIT ${this._maxRows}`,
    );

    const byJob = new Map<string, TaskResult>();
    for (const row of rows) {
      const otherId = str(row['o.jobId']);
      if (!otherId || otherId === anchor) continue;
      const via = str(row['e.name']);
      const existing = byJob.get(otherId);
      if (existing) {
        if (via && !existing.via?.includes(via)) existing.via?.push(via);
        continue;
      }
      byJob.set(otherId, {
        jobId: otherId,
        summary: str(row['o.summary']) ?? '',
        outcome: str(row['o.outcome']),
        ts: num(row['o.ts']),
        via: via ? [via] : [],
      });
    }

    // Rank by shared-entity count first (more overlap = more relevant), then
    // recency. This is the relational analogue of a relevance score.
    return [...byJob.values()]
      .sort((a, b) => {
        const overlap = (b.via?.length ?? 0) - (a.via?.length ?? 0);
        return overlap !== 0 ? overlap : (b.ts ?? 0) - (a.ts ?? 0);
      })
      .slice(0, limit);
  }

  /**
   * The supersession chain reachable from a decision, newest first.
   *
   * Returns the anchor at depth 0 followed by the decisions it supersedes,
   * transitively. Answers "why is this the current decision, and what did it
   * replace?" — a question that requires edges, not text.
   */
  decisionChain(summary: string, limit = 10): DecisionResult[] {
    const anchor = clamp(summary);
    if (!anchor) return [];

    const anchorRows = this._query(
      `MATCH ${nodePattern('d', 'Decision', { summary: anchor })} RETURN d.summary, d.rationale, d.ts LIMIT 1`,
    );
    const first = anchorRows[0];
    if (!first) return [];

    const chain: DecisionResult[] = [
      {
        summary: str(first['d.summary']) ?? anchor,
        rationale: str(first['d.rationale']),
        ts: num(first['d.ts']),
        depth: 0,
      },
    ];

    // Walk one hop at a time rather than using a variable-length path, because
    // `*1..n` returns the reachable set without the hop count, and the depth is
    // the whole point of a supersession chain.
    const seen = new Set<string>([chain[0]!.summary]);
    let current = chain[0]!.summary;
    for (let depth = 1; depth < limit; depth++) {
      const rows = this._query(
        `MATCH ${nodePattern('a', 'Decision', { summary: current })}-[:SUPERSEDES]->${nodePattern('b', 'Decision')} ` +
          `RETURN b.summary, b.rationale, b.ts LIMIT 1`,
      );
      const row = rows[0];
      if (!row) break;
      const next = str(row['b.summary']);
      if (!next || seen.has(next)) break; // cycle guard
      seen.add(next);
      chain.push({ summary: next, rationale: str(row['b.rationale']), ts: num(row['b.ts']), depth });
      current = next;
    }
    return chain;
  }

  /** Known failures for a tool, most recent first. */
  failuresForTool(tool: string, limit = 10): FailureResult[] {
    const anchor = clamp(tool, 100);
    if (!anchor) return [];

    const rows = this._query(
      `MATCH ${nodePattern('f', 'Failure', { tool: anchor })} ` +
        `RETURN f.tool, f.signature, f.hint, f.ts LIMIT ${this._maxRows}`,
    );
    return rows
      .map(row => ({
        tool: str(row['f.tool']) ?? anchor,
        signature: str(row['f.signature']) ?? '',
        hint: str(row['f.hint']),
        ts: num(row['f.ts']),
      }))
      .filter(f => f.signature.length > 0)
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      .slice(0, limit);
  }

  /**
   * Node counts per label.
   *
   * Worth watching: there is no retention policy yet, and because SparrowDB has
   * no indexes every query is a full scan, so read latency grows linearly with
   * these numbers (~50 ms for a one-hop query at 2k Task nodes). A pruning pass
   * — drop Tasks older than N days and the Entities left with no edges — is the
   * obvious next piece of work, but it needs node deletion, which SparrowDB
   * currently only supports for single-node patterns with no attached edges.
   */
  stats(): GraphStats {
    return {
      entities: this._count('Entity'),
      tasks: this._count('Task'),
      decisions: this._count('Decision'),
      failures: this._count('Failure'),
    };
  }

  // ── Maintenance ───────────────────────────────────────────────────

  /** Flush the WAL and compact. Measured at ~90 ms on a 2k-node graph. */
  checkpoint(): void {
    try {
      this._db.checkpoint();
    } catch (err) {
      log.debug({ err }, 'Graph checkpoint failed');
    }
  }

  /** Checkpoint plus adjacency-list sort. Run rarely; it rewrites the CSR. */
  optimize(): void {
    try {
      this._db.optimize();
    } catch (err) {
      log.debug({ err }, 'Graph optimize failed');
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  /**
   * Create a node with all its properties, or update the properties of the one
   * that already exists.
   *
   * `identity` is the subset of properties that defines the node's identity
   * (`{jobId}` for a Task, `{name}` for an Entity); `attributes` is everything
   * else. Splitting them matters because `MERGE` matches on the *whole*
   * property map, so `MERGE (:Entity {name, kind})` would fork a second node
   * the moment an entity is reclassified. Identity must be matched alone.
   *
   * Doing an existence check first — rather than always MERGE-then-SET — makes
   * the common path (a node seen for the first time) two statements instead of
   * one per property. Writes dominate this workload and each statement is a
   * full scan, so that is the difference between 2 and 5 scans per task.
   */
  private _upsertNode(
    label: string,
    identity: Record<string, string>,
    attributes: Record<string, PropertyValue>,
  ): void {
    if (this._exists(label, identity)) {
      // Update in place. Each SET is its own statement: SparrowDB allows only
      // one clause per statement, and only single-node MATCH … SET patterns.
      for (const [key, value] of Object.entries(attributes)) {
        this._exec(
          `MATCH ${nodePattern('n', label, identity)} ` +
            `SET n.${validateIdentifier(key, 'property key')} = ${escapeValue(value, MAX_PROP_LENGTH)}`,
        );
      }
      return;
    }
    this._exec(`CREATE ${nodePattern('n', label, { ...identity, ...attributes })}`);
  }

  /**
   * Create an edge between two nodes selected by inline property maps.
   *
   * Uses the comma-separated MATCH form because SparrowDB rejects both a second
   * `MATCH` clause and a `WHERE` before `CREATE`. If either endpoint is missing
   * the statement is a silent no-op, which is the behaviour we want: the edge
   * simply is not created.
   *
   * Choosing between MERGE and CREATE is not a style question here — the two
   * verbs have different, individually broken behaviours, verified against
   * sparrowdb@0.1.21:
   *
   *   - `MERGE (a)-[:R {p: 'v'}]->(b)` is idempotent but **silently discards
   *     the edge properties**: `r.p` reads back as null.
   *   - `CREATE (a)-[:R {p: 'v'}]->(b)` stores the properties but is **not
   *     idempotent**: replaying it appends duplicate edges, and a traversal
   *     then returns the same neighbour N times. (`count(r)` misleadingly
   *     reports 1, so counting cannot be used to detect this.)
   *
   * So: property-less edges use MERGE, and edges that carry properties are
   * guarded by an existence check and then CREATEd. The check is a
   * read-before-write, which is safe despite the lack of transactions because
   * the graph worker is the process's only writer.
   */
  private _link(
    fromLabel: string,
    fromProps: Record<string, string>,
    edgeType: string,
    toLabel: string,
    toProps: Record<string, string>,
    edgeProps: Record<string, string> = {},
  ): void {
    const type = validateIdentifier(edgeType, 'relationship type');
    const from = nodePattern('a', fromLabel, fromProps);
    const to = nodePattern('b', toLabel, toProps);
    const props = formatPropertyMap(edgeProps);

    if (props === '') {
      this._exec(`MATCH ${from}, ${to} MERGE (a)-[:${type}]->(b)`);
      return;
    }

    if (this._edgeExists(fromLabel, fromProps, type, toLabel, toProps)) return;
    this._exec(`MATCH ${from}, ${to} CREATE (a)-[:${type}${props}]->(b)`);
  }

  /** Whether an edge of `type` already joins the two pinned endpoints. */
  private _edgeExists(
    fromLabel: string,
    fromProps: Record<string, string>,
    type: string,
    toLabel: string,
    toProps: Record<string, string>,
  ): boolean {
    // Project a property we know exists, since we just matched on it. There is
    // no universal "return the edge" projection: `RETURN r` yields hashed
    // column ids rather than the documented EdgeRef.
    const projected = Object.keys(toProps)[0] ?? Object.keys(fromProps)[0];
    if (!projected) return false;
    const variable = Object.keys(toProps)[0] ? 'b' : 'a';

    const rows = this._query(
      `MATCH ${nodePattern('a', fromLabel, fromProps)}-[r:${type}]->${nodePattern('b', toLabel, toProps)} ` +
        `RETURN ${variable}.${validateIdentifier(projected, 'property key')} LIMIT 1`,
    );
    return rows.length > 0;
  }

  private _exists(label: string, props: Record<string, string>): boolean {
    const rows = this._query(
      `MATCH ${nodePattern('n', label, props)} RETURN count(n) AS c`,
    );
    return num(rows[0]?.['c']) !== null && (num(rows[0]?.['c']) ?? 0) > 0;
  }

  private _count(label: string): number {
    const rows = this._query(`MATCH ${nodePattern('n', label)} RETURN count(n) AS c`);
    return num(rows[0]?.['c']) ?? 0;
  }

  /** Execute a statement, discarding the result. Throws on parse errors. */
  private _exec(cypher: string): void {
    this._db.execute(cypher);
  }

  /**
   * Execute a read and return its rows.
   *
   * Read failures degrade to an empty result rather than propagating: a graph
   * that cannot answer is strictly better than a graph that breaks the caller.
   */
  private _query(cypher: string): Array<Record<string, unknown>> {
    try {
      return this._db.execute(cypher).rows;
    } catch (err) {
      log.debug({ err, cypher: cypher.slice(0, 200) }, 'Graph query failed; returning no rows');
      return [];
    }
  }
}

// ── Value coercion ──────────────────────────────────────────────────
//
// SparrowDB returns `Value = null | number | boolean | string | NodeRef | EdgeRef`.
// We only ever RETURN scalar properties, but a missing property comes back as
// null, so every read is narrowed defensively.

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Trim and length-cap a property string. */
function clamp(value: unknown, max = MAX_PROP_LENGTH): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Coerce a timestamp to a safe integer literal, defaulting to now. */
function safeTs(ts: unknown): number {
  return typeof ts === 'number' && Number.isFinite(ts) ? Math.trunc(ts) : Date.now();
}

function dedupeTasks(rows: Array<Record<string, unknown>>): TaskResult[] {
  const byJob = new Map<string, TaskResult>();
  for (const row of rows) {
    const jobId = str(row['t.jobId']);
    if (!jobId || byJob.has(jobId)) continue;
    byJob.set(jobId, {
      jobId,
      summary: str(row['t.summary']) ?? '',
      outcome: str(row['t.outcome']),
      ts: num(row['t.ts']),
    });
  }
  return [...byJob.values()];
}

function sortByTsDesc(tasks: TaskResult[]): TaskResult[] {
  return tasks.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
}
