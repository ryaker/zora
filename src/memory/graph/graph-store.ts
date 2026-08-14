/**
 * GraphStore — typed adapter over the `sparrowdb` embedded graph (MEM-30, MEM-33).
 *
 * This class exists to make SparrowDB's 0.1.x Cypher dialect a private detail.
 * Nothing above it should ever assemble a query string.
 *
 * ## Values are bound, never interpolated (MEM-33)
 *
 * MEM-30 shipped against 0.1.21, which had no parameter binding at all: every
 * value was textually interpolated and defended by a hand-rolled escaper.
 * 0.1.24 added `executeWithParams(cypher, params)` *including* parameterized
 * `CREATE`, so that escaper is deleted and every value now travels as a bound
 * parameter. Verified against the published 0.1.24 tarball: the original
 * exploit payload `", role: "admin` stored as a literal `name` with `role`
 * null.
 *
 * Parameter keys are **bare names** — `{name: 'Alice'}`, never
 * `{'$name': 'Alice'}`. A `$`-prefixed key raises
 * `parameter $x was referenced in the query but not supplied`, so getting it
 * wrong fails loudly, but it is still wrong.
 *
 * The quirks this adapter still hides, all verified against sparrowdb@0.1.24:
 *
 *   1. **Edge writes cannot bind their endpoints.** This is the sharp one.
 *      `MATCH (a:L {k: $v}), (b:L2 {k: $w}) CREATE (a)-[:R]->(b)` under
 *      `executeWithParams` **silently creates nothing** — no error, no edge —
 *      and the `MERGE` form raises
 *      `parameterized MATCH...MERGE relationship ... not yet supported`
 *      (even with an empty params object, so it is the code path, not the
 *      payload). Endpoints are therefore pinned by the `zid` surrogate key
 *      from `identifiers.ts`, a digest we compute ourselves, so the statement
 *      still contains no untrusted text. See `_link`.
 *   2. **Labels cannot be bound.** `MATCH (n:$lbl)` is rejected with
 *      `expected label/type name, got Param("lbl")`. Labels, relationship
 *      types and property keys are validated against the ontology allowlist in
 *      `identifiers.ts` instead.
 *   3. **Every node in a chained pattern must carry a label.** An unlabeled
 *      *middle* node silently returns `[]` when the chain spans multiple
 *      labels over one relationship type — exactly the shape of `relatedTasks`
 *      (`Task -[:MENTIONS]-> Entity <-[:MENTIONS]- Task`) — and an unlabeled
 *      *head or tail* throws `not found`. The requirement is the label, not
 *      the variable: `(:Entity)` is fine, `(m)` is not. Depth is not a
 *      constraint; a fully-labeled 3-hop chain works. A silent `[]` in the
 *      two-hop recall path would read as "no results" rather than as a bug,
 *      so `tests/unit/memory/graph/emitted-patterns.test.ts` asserts every
 *      pattern this file emits labels every node.
 *   4. **Variable-length inbound traversal is unimplemented upstream**
 *      (`<-[:R*1..3]-` → `not yet implemented`). Inbound traversal past one
 *      hop must therefore be written as a fully-labeled fixed-hop chain, which
 *      is what `relatedTasks` does.
 *   5. **No transactions.** `ReadTx.execute()` / `WriteTx.execute()` throw
 *      (upstream SPA-99 / SPA-100), so all access auto-commits per statement.
 *      There is no multi-statement atomicity, so every write here is idempotent
 *      and safe to replay: a crash between two statements leaves a partial but
 *      valid graph.
 *   6. **One clause per statement.** `CREATE … CREATE …` is a parse error, and
 *      so is a second `MATCH`. Edge creation uses the comma form
 *      `MATCH (a:X {…}), (b:Y {…}) CREATE (a)-[:R]->(b)`. `MATCH … WHERE …
 *      CREATE …` is rejected with `expected RETURN clause`, so edge endpoints
 *      must be selected by inline property maps only.
 *   7. **`RETURN n` is unusable.** Returning a whole node yields a map keyed by
 *      hashed column names (`col_2369371622`), not the documented
 *      `{$type:'node', id}` ref. Every read here returns explicit properties.
 *   8. **`ORDER BY` is not trusted.** All ordering is done in JavaScript after
 *      a capped scan, and `LIMIT` is applied here rather than in the engine —
 *      an engine-side LIMIT over an unsorted scan truncates the wrong rows.
 *   9. **No indexes.** Property lookups are full scans; cost grows linearly
 *      with graph size. This is why the store runs on a worker thread — see
 *      graph-memory-worker.ts.
 *  10. **Edge properties are write-once.** `MATCH (a)-[r:R]->(b) SET r.x = …`
 *      fails with "supports only single-node patterns", and there is no
 *      `REMOVE`. The ontology is designed so nothing here needs to mutate one:
 *      a superseded decision gets a new `SUPERSEDES` edge rather than an
 *      edited one. Node properties *can* be updated, through a single-node
 *      `MATCH … SET`, which is what every writer below uses.
 *  11. **`MERGE` on an edge drops its properties; `CREATE` on an edge is not
 *      idempotent.** Verified on 0.1.24 and unchanged from 0.1.21. So
 *      property-less edges use `MERGE`, and property-carrying edges are
 *      guarded by an existence check and then `CREATE`d.
 *  12. **`null` and array property values are rejected at CREATE.** Optional
 *      fields are omitted rather than nulled, and only strings and numbers are
 *      written. Booleans are avoided entirely: they round-trip as 1/0 and
 *      become indistinguishable from integers on read.
 *
 * Missing labels and relationship types are not errors: a pattern over a label
 * that has never been written returns zero rows.
 *
 * ## On-disk compatibility
 *
 * The `zid` surrogate property is new in MEM-33. A graph written by the MEM-30
 * adapter has no `zid`, so its nodes are invisible to the new identity lookups
 * and would be duplicated rather than updated. `open()` detects that and warns
 * once; the tier is off by default and experimental, and the graph is derived
 * data rebuilt from ordinary memory, so the remedy is to delete the database
 * directory rather than to migrate it.
 */

import {
  GraphIdentifierError,
  assertEdgeType,
  assertNodeLabel,
  assertPropertyKey,
  assertSurrogateId,
  surrogateId,
} from './identifiers.js';
import type { CypherParams, SparrowDatabase, SparrowModule } from './sparrow-loader.js';
import { loadSparrow } from './sparrow-loader.js';
import {
  isEntityKind,
  NODE_LABELS,
  type DecisionRecord,
  type DecisionResult,
  type EntityKind,
  type EntityRecord,
  type FailureRecord,
  type FailureResult,
  type GraphStats,
  type GraphWrite,
  type NeighbourResult,
  type NodeLabel,
  type TaskRecord,
  type TaskResult,
} from './graph-types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('graph-store');

/** Longest string we let into a node property. Summaries are LLM-generated. */
const MAX_PROP_LENGTH = 2000;

/** Hard ceiling on any `LIMIT` we emit, so the literal is always a small int. */
const MAX_LIMIT = 10_000;

export interface GraphStoreOptions {
  /** Filesystem path for the database directory. */
  path: string;
  /** Hard cap on rows pulled from the engine before JS-side sort + slice. */
  maxRowsScanned?: number;
  /** Injectable module, for tests. Defaults to the lazily-loaded `sparrowdb`. */
  module?: SparrowModule;
}

/** The identity of a node: its label plus the single property that names it. */
interface NodeIdentity {
  label: NodeLabel;
  key: string;
  value: string;
  zid: string;
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
    this._maxRows = clampLimit(maxRows);
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
      // Parameter binding is not optional for this adapter — without it every
      // value would have to be interpolated, and the escaper that used to make
      // that safe is gone. An older `sparrowdb` is therefore an unavailable
      // one, reported through the same inert path as a missing binary rather
      // than by failing on the first write.
      if (typeof db.executeWithParams !== 'function') {
        log.warn(
          { path: options.path },
          'Installed sparrowdb has no executeWithParams (needs >= 0.1.24) — ' +
            'graph memory tier is inert',
        );
        return null;
      }
      const store = new GraphStore(db, options.maxRowsScanned ?? 500);
      store._warnIfPreSurrogate(options.path);
      return store;
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
    this._upsertNode(identity('Entity', 'name', name), { kind });
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

    const taskId = identity('Task', 'jobId', jobId);
    this._upsertNode(taskId, {
      summary: clamp(task.summary),
      outcome: clamp(task.outcome, 100),
      ts: safeTs(task.ts),
    });

    for (const entity of mentions) {
      const name = clamp(entity.name);
      if (!name) continue;
      this.upsertEntity(entity);
      this._link(taskId, 'MENTIONS', identity('Entity', 'name', name));
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

    const decisionId = identity('Decision', 'summary', summary);
    this._upsertNode(decisionId, {
      rationale: clamp(decision.rationale),
      ts: safeTs(decision.ts),
    });

    if (jobId) {
      const taskJobId = clamp(jobId, 200);
      if (taskJobId) this._link(identity('Task', 'jobId', taskJobId), 'PRODUCED', decisionId);
    }
    if (supersedes) {
      const older = clamp(supersedes);
      // Only link to a decision that already exists; creating a placeholder
      // would pollute the chain with an empty node.
      if (older) {
        const olderId = identity('Decision', 'summary', older);
        if (this._exists(olderId)) this._link(decisionId, 'SUPERSEDES', olderId);
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

    const failureId = identity('Failure', 'signature', signature);
    this._upsertNode(failureId, {
      tool: clamp(failure.tool, 100),
      hint: clamp(failure.hint),
      ts: safeTs(failure.ts),
    });

    if (jobId) {
      const taskJobId = clamp(jobId, 200);
      if (taskJobId) this._link(identity('Task', 'jobId', taskJobId), 'HIT', failureId);
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
    // against sparrowdb: when an edge property and a node property share a
    // name, projecting both in one RETURN resolves the edge's value to the
    // node's — `RETURN b.kind, r.kind` yields the node's kind twice. Property
    // names must be unique across the whole ontology, not just per label.
    this._link(
      identity('Entity', 'name', fromName),
      'RELATES_TO',
      identity('Entity', 'name', toName),
      { relKind: clamp(kind, 100) },
    );
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
   * Two queries, one per direction, and *both use a left-to-right arrow*. That
   * is not a workaround: 0.1.24 honours arrow direction correctly (0.1.21 did
   * not), and anchoring on the right-hand side with a `->` arrow is the plain
   * way to ask for inbound edges. It also sidesteps the undirected form
   * `(a)-[r:R]-(b)`, which drops the edge properties on the reverse leg.
   */
  neighbours(name: string, limit = 20): NeighbourResult[] {
    const anchor = clamp(name);
    if (!anchor) return [];

    // Both nodes labeled in both patterns — see the chained-pattern rule in
    // the class header. These are single-hop, but the rule is enforced
    // uniformly so no pattern here is ever one edit away from a silent [].
    const out = this._query(
      `MATCH (a:Entity {name: $name})-[r:RELATES_TO]->(b:Entity) ` +
        `RETURN b.name, b.kind, r.relKind LIMIT ${this._maxRows}`,
      { name: anchor },
    );
    const inbound = this._query(
      `MATCH (b:Entity)-[r:RELATES_TO]->(a:Entity {name: $name}) ` +
        `RETURN b.name, b.kind, r.relKind LIMIT ${this._maxRows}`,
      { name: anchor },
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
      `MATCH (t:Task)-[:MENTIONS]->(e:Entity {name: $name}) ` +
        `RETURN t.jobId, t.summary, t.outcome, t.ts LIMIT ${this._maxRows}`,
      { name: anchor },
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
   * Two engine constraints shape how this is written, and both are load-bearing:
   *
   *   - The second leg is **inbound** ("other tasks pointing at the same
   *     entity"). Variable-length inbound (`<-[:MENTIONS*1..2]-`) is
   *     unimplemented upstream, so this must be a fixed-hop chain. It is.
   *   - Every node in the chain is labeled — `(t:Task)`, `(e:Entity)`,
   *     `(o:Task)`. This chain is precisely the dangerous shape: multiple
   *     labels over a single relationship type. Dropping the label from `e`
   *     makes the engine return `[]` with no error, which would surface to the
   *     user as "no related tasks" rather than as a bug. Dropping it from `o`
   *     throws `not found`.
   *
   * The self-match (`o` = the anchor task) is filtered in JavaScript rather
   * than with `WHERE o.jobId <> t.jobId`, because the anchor is already pinned
   * by a bound parameter and a variable-to-variable predicate would make the
   * engine evaluate it over the whole scan.
   */
  relatedTasks(jobId: string, limit = 10): TaskResult[] {
    const anchor = clamp(jobId, 200);
    if (!anchor) return [];

    const rows = this._query(
      `MATCH (t:Task {jobId: $jobId})-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(o:Task) ` +
        `RETURN o.jobId, o.summary, o.outcome, o.ts, e.name LIMIT ${this._maxRows}`,
      { jobId: anchor },
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
      `MATCH (d:Decision {summary: $summary}) RETURN d.summary, d.rationale, d.ts LIMIT 1`,
      { summary: anchor },
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
        `MATCH (a:Decision {summary: $summary})-[:SUPERSEDES]->(b:Decision) ` +
          `RETURN b.summary, b.rationale, b.ts LIMIT 1`,
        { summary: current },
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
      `MATCH (f:Failure {tool: $tool}) ` +
        `RETURN f.tool, f.signature, f.hint, f.ts LIMIT ${this._maxRows}`,
      { tool: anchor },
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
   * these numbers. A pruning pass — drop Tasks older than N days and the
   * Entities left with no edges — is the obvious next piece of work.
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

  /** Flush the WAL and compact. */
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
   * The node is found by its `zid` surrogate key rather than by its identity
   * property, so the lookup, the update and any later edge write all agree on
   * one selector. Identity and attributes stay separate because a `MERGE` over
   * the *whole* property map would fork a second node the moment an entity is
   * reclassified; matching identity alone is what makes the upsert an upsert.
   *
   * Doing an existence check first — rather than always MERGE-then-SET — makes
   * the common path (a node seen for the first time) two statements instead of
   * one per property. Writes dominate this workload and each statement is a
   * full scan, so that is the difference between 2 and 5 scans per task.
   */
  private _upsertNode(node: NodeIdentity, attributes: Record<string, string | number>): void {
    if (this._exists(node)) {
      // Update in place. Each SET is its own statement: SparrowDB allows only
      // one clause per statement, and only single-node MATCH … SET patterns.
      for (const [key, value] of Object.entries(attributes)) {
        this._exec(
          `MATCH (n:${node.label} {zid: $zid}) SET n.${assertPropertyKey(key)} = $value`,
          { zid: node.zid, value },
        );
      }
      return;
    }

    const keys = Object.keys(attributes).map(k => assertPropertyKey(k));
    // An attribute sharing the identity key (or `zid`) would emit the key twice
    // in one property map and let a mutable attribute overwrite the node's
    // identity. No caller does this today; the guard is here so none can start.
    for (const key of keys) {
      if (key === node.key || key === 'zid') {
        throw new GraphIdentifierError(
          `Attribute ${JSON.stringify(key)} collides with the identity of a ${node.label} node`,
        );
      }
    }
    const map = ['zid: $zid', `${node.key}: $identity`, ...keys.map(k => `${k}: $${k}`)].join(', ');
    this._exec(`CREATE (n:${node.label} {${map}})`, {
      zid: node.zid,
      identity: node.value,
      ...attributes,
    });
  }

  /**
   * Create an edge between two nodes.
   *
   * Endpoints are pinned by `zid`, interpolated as a literal, because
   * parameterized edge writes do not work: the `CREATE` form silently creates
   * nothing and the `MERGE` form throws (see quirk 1 in the class header).
   * `assertSurrogateId` is what makes that interpolation safe — a `zid` is 32
   * hex characters generated by `surrogateId()`, so the statement carries no
   * untrusted text even though it is assembled by hand. Edge *properties* are
   * still bound, since `CREATE` accepts parameters for them.
   *
   * If either endpoint is missing the statement is a silent no-op, which is the
   * behaviour we want: the edge simply is not created.
   *
   * Choosing between MERGE and CREATE is not a style question here — the two
   * verbs have different, individually broken behaviours, verified against
   * sparrowdb 0.1.24:
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
    from: NodeIdentity,
    edgeType: string,
    to: NodeIdentity,
    edgeProps: Record<string, string> = {},
  ): void {
    const type = assertEdgeType(edgeType);
    const match =
      `MATCH (a:${from.label} {zid: '${assertSurrogateId(from.zid)}'}), ` +
      `(b:${to.label} {zid: '${assertSurrogateId(to.zid)}'})`;

    const keys = Object.entries(edgeProps).filter(([, v]) => v !== '');
    if (keys.length === 0) {
      // No parameters at all, and nothing untrusted in the statement, so the
      // unparameterized path is the correct one here rather than a fallback:
      // `executeWithParams` rejects a MERGE-relationship even with `{}`.
      this._exec(`${match} MERGE (a)-[:${type}]->(b)`);
      return;
    }

    if (this._edgeExists(from, type, to)) return;
    const map = keys.map(([k]) => `${assertPropertyKey(k)}: $${k}`).join(', ');
    this._exec(`${match} CREATE (a)-[:${type} {${map}}]->(b)`, Object.fromEntries(keys));
  }

  /** Whether an edge of `type` already joins the two pinned endpoints. */
  private _edgeExists(from: NodeIdentity, type: string, to: NodeIdentity): boolean {
    // Both nodes labeled, per the chained-pattern rule. `zid` is projected
    // because it is guaranteed present on any node this adapter wrote — there
    // is no universal "return the edge" projection, since `RETURN r` yields
    // hashed column ids rather than the documented EdgeRef.
    const rows = this._query(
      `MATCH (a:${from.label} {zid: $fromZid})-[r:${assertEdgeType(type)}]->` +
        `(b:${to.label} {zid: $toZid}) RETURN b.zid LIMIT 1`,
      { fromZid: from.zid, toZid: to.zid },
    );
    return rows.length > 0;
  }

  private _exists(node: NodeIdentity): boolean {
    const rows = this._query(`MATCH (n:${node.label} {zid: $zid}) RETURN count(n) AS c`, {
      zid: node.zid,
    });
    return (num(rows[0]?.['c']) ?? 0) > 0;
  }

  private _count(label: NodeLabel): number {
    // No values involved, so no parameters: the only variable text is a label
    // from the ontology allowlist.
    const rows = this._query(`MATCH (n:${assertNodeLabel(label)}) RETURN count(n) AS c`);
    return num(rows[0]?.['c']) ?? 0;
  }

  /**
   * Warn once if this database predates the `zid` surrogate key (MEM-33).
   *
   * One `LIMIT 1` probe per label at open time, rather than a check on every
   * write. A legacy node is not corrupt, but it is unreachable by the new
   * identity lookups, so writes would duplicate it rather than update it.
   */
  private _warnIfPreSurrogate(path: string): void {
    for (const label of NODE_LABELS) {
      const rows = this._query(`MATCH (n:${label}) RETURN n.zid LIMIT 1`);
      const first = rows[0];
      if (first && str(first['n.zid']) === null) {
        log.warn(
          { path, label },
          'Graph database predates MEM-33 and has no surrogate keys — existing nodes will be ' +
            'duplicated rather than updated. Delete the database directory to rebuild it.',
        );
        return;
      }
    }
  }

  /**
   * Execute a statement, discarding the result. Throws on parse errors.
   *
   * Routes to `executeWithParams` whenever there are parameters to bind, and to
   * plain `execute` only for statements that contain no values at all.
   */
  private _exec(cypher: string, params?: CypherParams): void {
    if (params && Object.keys(params).length > 0) this._db.executeWithParams(cypher, params);
    else this._db.execute(cypher);
  }

  /**
   * Execute a read and return its rows.
   *
   * Read failures degrade to an empty result rather than propagating: a graph
   * that cannot answer is strictly better than a graph that breaks the caller.
   */
  private _query(cypher: string, params?: CypherParams): Array<Record<string, unknown>> {
    try {
      const result =
        params && Object.keys(params).length > 0
          ? this._db.executeWithParams(cypher, params)
          : this._db.execute(cypher);
      return result.rows;
    } catch (err) {
      log.debug({ err, cypher: cypher.slice(0, 200) }, 'Graph query failed; returning no rows');
      return [];
    }
  }
}

/** Build a node identity, validating the label and key against the ontology. */
function identity(label: NodeLabel, key: string, value: string): NodeIdentity {
  return {
    label: assertNodeLabel(label),
    key: assertPropertyKey(key),
    value,
    zid: surrogateId(label, key, value),
  };
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

/** Coerce a timestamp to a safe integer, defaulting to now. */
function safeTs(ts: unknown): number {
  return typeof ts === 'number' && Number.isFinite(ts) ? Math.trunc(ts) : Date.now();
}

/**
 * Coerce a row limit to a small positive integer.
 *
 * `LIMIT` cannot be a bound parameter, so this number is interpolated. It comes
 * from our own config rather than from user input, but clamping it here means
 * the interpolated text is provably a short decimal integer regardless.
 */
function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 500;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
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
