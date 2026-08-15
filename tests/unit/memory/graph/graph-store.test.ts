/**
 * GraphStore tests — run against the real `sparrowdb` native engine.
 *
 * These are deliberately not mocked. The whole point of the adapter is to
 * absorb a specific engine's parser and planner quirks, and a mock would assert
 * my beliefs about SparrowDB rather than SparrowDB's behaviour. When the native
 * module is unavailable (unsupported platform, `--no-optional` install) the
 * suite skips rather than fails — that is the same graceful degradation the
 * production path takes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GraphStore } from '../../../../src/memory/graph/graph-store.js';
import { loadSparrow } from '../../../../src/memory/graph/sparrow-loader.js';

// Resolved at collection time — `describe.skip` is decided before any hook
// runs, so a `beforeAll` would be too late.
const sparrowAvailable = (await loadSparrow()).available;

const describeIfNative = (): typeof describe | typeof describe.skip =>
  sparrowAvailable ? describe : describe.skip;

describe('GraphStore', () => {
  let tmpDir: string;
  let store: GraphStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-graph-test-'));
    const opened = await GraphStore.open({ path: path.join(tmpDir, 'graph.db') });
    // TEST-21: `if (opened) store = opened` left `store` pointing at the
    // PREVIOUS test's store, whose tmpDir afterEach had already deleted. A
    // single failed open therefore surfaced as an unrelated assertion failing
    // in a later test, with nothing naming the real cause — which is how this
    // file produced intermittent failures in different tests on different runs
    // under full-suite load. Null it first, so a stale handle cannot be reused,
    // and let the native-guarded tests report the open failure themselves.
    store = null as unknown as GraphStore;
    if (opened) store = opened;
    else if (sparrowAvailable) {
      throw new Error(
        `GraphStore.open returned null at ${tmpDir} while the native module reports available — ` +
          'the open failed rather than the module being absent.',
      );
    }
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('opens a store when the native module is present, or returns null when it is not', async () => {
    const opened = await GraphStore.open({ path: path.join(tmpDir, 'probe.db') });
    expect(opened === null).toBe(!sparrowAvailable);
  });

  describeIfNative()('entities', () => {
    it('creates an entity and reads it back through a traversal', () => {
      store.upsertEntity({ name: 'zora', kind: 'project' });
      store.relateEntities({ name: 'alice', kind: 'person' }, { name: 'zora', kind: 'project' }, 'maintains');

      const neighbours = store.neighbours('alice');
      expect(neighbours).toHaveLength(1);
      expect(neighbours[0]).toMatchObject({
        name: 'zora',
        kind: 'project',
        relation: 'maintains',
        direction: 'out',
      });
    });

    it('reports the inbound direction from the other end', () => {
      // 0.1.21 ignored arrow direction entirely — `(a)<-[r:R]-(b)` returned the
      // OUTBOUND neighbours — and 0.1.24 fixed it. The adapter asks for inbound
      // edges by anchoring on the right-hand side of a `->` arrow, which is
      // correct under both. If it ever reverts, this test returns zero rows.
      store.relateEntities({ name: 'alice', kind: 'person' }, { name: 'zora', kind: 'project' }, 'maintains');
      const neighbours = store.neighbours('zora');
      expect(neighbours).toHaveLength(1);
      expect(neighbours[0]).toMatchObject({ name: 'alice', kind: 'person', direction: 'in' });
    });

    it('separates outbound from inbound neighbours', () => {
      store.relateEntities({ name: 'alice', kind: 'person' }, { name: 'zora', kind: 'project' }, 'maintains');
      store.relateEntities({ name: 'bob', kind: 'person' }, { name: 'alice', kind: 'person' }, 'knows');

      const neighbours = store.neighbours('alice');
      expect(neighbours).toHaveLength(2);
      expect(neighbours.find(n => n.name === 'zora')).toMatchObject({
        direction: 'out',
        relation: 'maintains',
      });
      expect(neighbours.find(n => n.name === 'bob')).toMatchObject({
        direction: 'in',
        relation: 'knows',
      });
    });

    it('is idempotent — re-upserting does not duplicate the node', () => {
      for (let i = 0; i < 5; i++) store.upsertEntity({ name: 'zora', kind: 'project' });
      expect(store.stats().entities).toBe(1);
    });

    it('updates the kind of an existing entity rather than forking it', () => {
      store.upsertEntity({ name: 'zora', kind: 'concept' });
      store.upsertEntity({ name: 'zora', kind: 'project' });
      expect(store.stats().entities).toBe(1);

      store.relateEntities({ name: 'alice', kind: 'person' }, { name: 'zora', kind: 'project' }, 'maintains');
      expect(store.neighbours('alice')[0]?.kind).toBe('project');
    });

    it('falls back to "concept" for an unknown entity kind', () => {
      store.upsertEntity({ name: 'thing', kind: 'nonsense' as never });
      store.relateEntities({ name: 'alice', kind: 'person' }, { name: 'thing', kind: 'nonsense' as never }, 'x');
      expect(store.neighbours('alice')[0]?.kind).toBe('concept');
    });

    it('ignores empty names and self-relations', () => {
      store.upsertEntity({ name: '   ', kind: 'person' });
      store.relateEntities({ name: 'a', kind: 'person' }, { name: 'a', kind: 'person' }, 'self');
      expect(store.stats().entities).toBe(0);
    });

    it('returns nothing for an unknown anchor', () => {
      expect(store.neighbours('nobody')).toEqual([]);
    });

    it('does not duplicate a relation when the same fact is recorded repeatedly', () => {
      // Guards a sharp engine edge: `CREATE (a)-[:R {p}]->(b)` is not
      // idempotent — replaying it appends duplicate edges and a traversal then
      // returns the same neighbour N times — while `MERGE` on a property-
      // carrying edge silently drops the properties. The adapter guards the
      // CREATE with an existence check; without it this returns 4 rows.
      for (let i = 0; i < 4; i++) {
        store.relateEntities(
          { name: 'alice', kind: 'person' },
          { name: 'zora', kind: 'project' },
          'maintains',
        );
      }
      const neighbours = store.neighbours('alice');
      expect(neighbours).toHaveLength(1);
      expect(neighbours[0]?.relation).toBe('maintains');
    });

    it('keeps the relation label readable alongside the neighbour kind', () => {
      // Both `b.kind` (node) and the edge's relation label are projected in one
      // RETURN. If the edge property were also called `kind`, the engine would
      // resolve it to the node's value and `relation` would read 'project'.
      store.relateEntities(
        { name: 'alice', kind: 'person' },
        { name: 'zora', kind: 'project' },
        'maintains',
      );
      expect(store.neighbours('alice')[0]).toMatchObject({
        kind: 'project',
        relation: 'maintains',
      });
    });
  });

  describeIfNative()('tasks', () => {
    it('records a task with its mentions and finds it by entity', () => {
      store.recordTask(
        { jobId: 'job-1', summary: 'Deployed the API', outcome: 'success', ts: 1_700_000_000_000 },
        [
          { name: 'zora', kind: 'project' },
          { name: 'Bash', kind: 'tool' },
        ],
      );

      const tasks = store.tasksMentioning('zora');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        jobId: 'job-1',
        summary: 'Deployed the API',
        outcome: 'success',
        ts: 1_700_000_000_000,
      });
      expect(store.tasksMentioning('Bash')).toHaveLength(1);
      expect(store.stats()).toMatchObject({ tasks: 1, entities: 2 });
    });

    it('sorts tasks newest-first in JavaScript rather than trusting engine ORDER BY', () => {
      // The adapter sorts after a capped scan and applies LIMIT itself, because
      // an engine-side LIMIT over an unsorted scan truncates the wrong rows.
      // If it ever starts trusting the engine's ordering, this test fails.
      const entity = { name: 'zora', kind: 'project' } as const;
      store.recordTask({ jobId: 'old', summary: 'a', outcome: 'ok', ts: 100 }, [entity]);
      store.recordTask({ jobId: 'newest', summary: 'b', outcome: 'ok', ts: 900 }, [entity]);
      store.recordTask({ jobId: 'mid', summary: 'c', outcome: 'ok', ts: 500 }, [entity]);

      expect(store.tasksMentioning('zora').map(t => t.jobId)).toEqual(['newest', 'mid', 'old']);
    });

    it('honours the limit', () => {
      const entity = { name: 'zora', kind: 'project' } as const;
      for (let i = 0; i < 6; i++) {
        store.recordTask({ jobId: `job-${i}`, summary: `s${i}`, outcome: 'ok', ts: i }, [entity]);
      }
      expect(store.tasksMentioning('zora', 2)).toHaveLength(2);
    });

    it('is idempotent — re-recording the same job updates in place', () => {
      store.recordTask({ jobId: 'job-1', summary: 'first', outcome: 'ok', ts: 1 }, [
        { name: 'zora', kind: 'project' },
      ]);
      store.recordTask({ jobId: 'job-1', summary: 'second', outcome: 'failure', ts: 2 }, [
        { name: 'zora', kind: 'project' },
      ]);

      expect(store.stats().tasks).toBe(1);
      const tasks = store.tasksMentioning('zora');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ summary: 'second', outcome: 'failure' });
    });

    it('does not duplicate MENTIONS edges when a task is re-recorded', () => {
      for (let i = 0; i < 4; i++) {
        store.recordTask({ jobId: 'job-1', summary: 's', outcome: 'ok', ts: 1 }, [
          { name: 'zora', kind: 'project' },
        ]);
      }
      // Duplicate edges would show up as repeated rows in the traversal even
      // though `count(r)` still reports 1.
      expect(store.tasksMentioning('zora')).toHaveLength(1);
    });

    it('defaults a missing timestamp to now rather than writing garbage', () => {
      const before = Date.now();
      store.recordTask({ jobId: 'job-1', summary: 's', outcome: 'ok', ts: NaN }, [
        { name: 'zora', kind: 'project' },
      ]);
      const ts = store.tasksMentioning('zora')[0]?.ts ?? 0;
      expect(ts).toBeGreaterThanOrEqual(before);
    });
  });

  describeIfNative()('two-hop traversal', () => {
    it('finds other tasks that mention the same entities — with zero word overlap', () => {
      // The two summaries share no content words at all. A BM25 index scores
      // their similarity at zero; the graph connects them in one hop each way.
      store.recordTask(
        { jobId: 'job-1', summary: 'Rotated the signing key', outcome: 'success', ts: 10 },
        [{ name: 'zora', kind: 'project' }],
      );
      store.recordTask(
        { jobId: 'job-2', summary: 'Bumped minor version numbers', outcome: 'success', ts: 20 },
        [{ name: 'zora', kind: 'project' }],
      );
      store.recordTask(
        { jobId: 'job-3', summary: 'Unrelated grocery list', outcome: 'success', ts: 30 },
        [{ name: 'shopping', kind: 'concept' }],
      );

      const related = store.relatedTasks('job-1');
      expect(related.map(t => t.jobId)).toEqual(['job-2']);
      expect(related[0]?.via).toEqual(['zora']);
      expect(related[0]?.summary).toBe('Bumped minor version numbers');
    });

    it('excludes the anchor task itself', () => {
      store.recordTask({ jobId: 'job-1', summary: 'a', outcome: 'ok', ts: 1 }, [
        { name: 'zora', kind: 'project' },
      ]);
      expect(store.relatedTasks('job-1')).toEqual([]);
    });

    it('ranks by shared-entity count, then recency', () => {
      const zora = { name: 'zora', kind: 'project' } as const;
      const bash = { name: 'Bash', kind: 'tool' } as const;

      store.recordTask({ jobId: 'anchor', summary: 'a', outcome: 'ok', ts: 100 }, [zora, bash]);
      store.recordTask({ jobId: 'one-shared', summary: 'b', outcome: 'ok', ts: 900 }, [zora]);
      store.recordTask({ jobId: 'two-shared', summary: 'c', outcome: 'ok', ts: 200 }, [zora, bash]);

      const related = store.relatedTasks('anchor');
      // two-shared wins on overlap despite being older than one-shared.
      expect(related.map(t => t.jobId)).toEqual(['two-shared', 'one-shared']);
      expect(related[0]?.via?.sort()).toEqual(['Bash', 'zora']);
    });

    it('returns nothing for an unknown job', () => {
      expect(store.relatedTasks('no-such-job')).toEqual([]);
    });
  });

  describeIfNative()('decisions', () => {
    it('records a decision and links it to the task that produced it', () => {
      store.recordTask({ jobId: 'job-1', summary: 's', outcome: 'ok', ts: 1 });
      store.recordDecision(
        { summary: 'Use SparrowDB', rationale: 'Embedded, no server', ts: 2 },
        'job-1',
      );
      expect(store.stats().decisions).toBe(1);
    });

    it('walks a supersession chain in order, with depth', () => {
      store.recordDecision({ summary: 'Use flat files', rationale: 'simplest', ts: 1 });
      store.recordDecision({ summary: 'Use SQLite', rationale: 'queries', ts: 2 }, undefined, 'Use flat files');
      store.recordDecision({ summary: 'Use SparrowDB', rationale: 'graph', ts: 3 }, undefined, 'Use SQLite');

      const chain = store.decisionChain('Use SparrowDB');
      expect(chain.map(d => d.summary)).toEqual(['Use SparrowDB', 'Use SQLite', 'Use flat files']);
      expect(chain.map(d => d.depth)).toEqual([0, 1, 2]);
      expect(chain[1]?.rationale).toBe('queries');
    });

    it('does not create a placeholder for a superseded decision that was never recorded', () => {
      store.recordDecision({ summary: 'Use SparrowDB', rationale: 'graph', ts: 3 }, undefined, 'Never recorded');
      expect(store.stats().decisions).toBe(1);
      expect(store.decisionChain('Use SparrowDB').map(d => d.summary)).toEqual(['Use SparrowDB']);
    });

    it('returns an empty chain for an unknown decision', () => {
      expect(store.decisionChain('nothing like this')).toEqual([]);
    });

    it('terminates on a supersession cycle instead of looping forever', () => {
      store.recordDecision({ summary: 'A', rationale: 'a', ts: 1 });
      store.recordDecision({ summary: 'B', rationale: 'b', ts: 2 }, undefined, 'A');
      store.recordDecision({ summary: 'A', rationale: 'a', ts: 3 }, undefined, 'B'); // A -> B -> A

      const chain = store.decisionChain('A', 10);
      expect(chain.length).toBeLessThanOrEqual(3);
      expect(new Set(chain.map(d => d.summary)).size).toBe(chain.length);
    });
  });

  describeIfNative()('failures', () => {
    it('collapses repeated occurrences of the same signature onto one node', () => {
      store.recordTask({ jobId: 'job-1', summary: 'a', outcome: 'failure', ts: 1 });
      store.recordTask({ jobId: 'job-2', summary: 'b', outcome: 'failure', ts: 2 });
      const failure = {
        tool: 'Bash',
        signature: 'ENOENT: no such file or directory',
        hint: 'check the working directory',
        ts: 5,
      };
      store.recordFailure(failure, 'job-1');
      store.recordFailure(failure, 'job-2');

      expect(store.stats().failures).toBe(1);
      const found = store.failuresForTool('Bash');
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ signature: failure.signature, hint: failure.hint });
    });

    it('returns nothing for a tool with no recorded failures', () => {
      expect(store.failuresForTool('Read')).toEqual([]);
    });
  });

  describeIfNative()('hostile input', () => {
    // There is no escaper any more (MEM-33): hostile text is bound as a
    // parameter and never re-enters the parser. These drive real payloads
    // through the real engine and assert they neither corrupt the graph nor
    // change its shape.
    const hostileNames = [
      "'}) CREATE (evil:Entity {name:'pwned'}) MATCH (n:Entity {name:'",
      "it's a \"quoted\" name",
      'back\\slash\\\\name',
      'multi\nline\tname',
      "'; DROP GRAPH; --",
    ];

    it('round-trips hostile entity names without injecting anything', () => {
      for (const name of hostileNames) {
        store.relateEntities({ name: 'anchor', kind: 'concept' }, { name, kind: 'concept' }, 'rel');
      }

      // anchor + one node per hostile name, and nothing else.
      expect(store.stats().entities).toBe(hostileNames.length + 1);

      const names = store.neighbours('anchor', 50).map(n => n.name);
      for (const name of hostileNames) {
        // Control characters are sanitized to spaces on the way in.
        expect(names).toContain(name.replace(/[\n\t]/g, m => (m === '\n' ? '\n' : '\t')));
      }
      // The injected node from the first payload does not exist.
      expect(names).not.toContain('pwned');
    });

    it('round-trips a hostile task summary and keeps it queryable', () => {
      const summary = "'}) CREATE (evil:Task {jobId:'pwned'}) MATCH (t:Task {jobId:'";
      store.recordTask({ jobId: 'job-1', summary, outcome: 'ok', ts: 1 }, [
        { name: 'zora', kind: 'project' },
      ]);

      expect(store.stats().tasks).toBe(1);
      expect(store.tasksMentioning('zora')[0]?.summary).toBe(summary);
    });

    it('stores the original S0 payload inert, adding no property it did not ask for', () => {
      // The finding that started this whole thread: on 0.1.21,
      // `CREATE (:User {name: "<payload>"})` with `", role: "admin` closed the
      // name value and added a `role` property. Parameter binding is what makes
      // that impossible now, so this asserts the *outcome* rather than the
      // shape of a query — the payload must survive verbatim as data.
      const payload = '", role: "admin';
      store.recordTask({ jobId: 'job-1', summary: payload, outcome: 'ok', ts: 1 }, [
        { name: payload, kind: 'project' },
      ]);

      expect(store.stats()).toMatchObject({ tasks: 1, entities: 1 });
      const tasks = store.tasksMentioning(payload);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.summary).toBe(payload);
      // The task is reachable through an entity whose name is the raw payload,
      // which is only true if the value was stored as text rather than parsed.
      expect(tasks[0]?.jobId).toBe('job-1');
    });

    it('keeps a payload aimed at the surrogate key from hijacking a node identity', () => {
      // Edge endpoints are pinned by an interpolated `zid`, so the payload to
      // worry about is one shaped like a `zid` property map. It must land as a
      // name, not as a selector: two distinct entities, no merged identity.
      const decoy = "', zid: 'deadbeefdeadbeefdeadbeefdeadbeef";
      store.relateEntities({ name: 'anchor', kind: 'concept' }, { name: decoy, kind: 'concept' }, 'rel');
      store.relateEntities({ name: 'anchor', kind: 'concept' }, { name: 'plain', kind: 'concept' }, 'rel');

      expect(store.stats().entities).toBe(3);
      const names = store.neighbours('anchor', 50).map(n => n.name);
      expect(names).toContain(decoy);
      expect(names).toContain('plain');
    });

    it('truncates an absurdly long summary instead of building a giant query', () => {
      const summary = 'x'.repeat(50_000);
      store.recordTask({ jobId: 'job-1', summary, outcome: 'ok', ts: 1 }, [
        { name: 'zora', kind: 'project' },
      ]);
      const stored = store.tasksMentioning('zora')[0]?.summary ?? '';
      expect(stored.length).toBeLessThan(summary.length);
      expect(stored.length).toBeGreaterThan(0);
    });
  });

  describeIfNative()('persistence', () => {
    it('survives a checkpoint and reopen', async () => {
      store.recordTask({ jobId: 'job-1', summary: 'persisted', outcome: 'ok', ts: 1 }, [
        { name: 'zora', kind: 'project' },
      ]);
      store.checkpoint();

      const reopened = await GraphStore.open({ path: path.join(tmpDir, 'graph.db') });
      expect(reopened).not.toBeNull();
      expect(reopened!.tasksMentioning('zora')[0]?.summary).toBe('persisted');
    });
  });

  describeIfNative()('applyWrites', () => {
    it('applies a mixed batch', () => {
      store.applyWrites([
        { op: 'upsertEntity', entity: { name: 'zora', kind: 'project' } },
        {
          op: 'recordTask',
          task: { jobId: 'job-1', summary: 's', outcome: 'ok', ts: 1 },
          mentions: [{ name: 'zora', kind: 'project' }],
        },
        { op: 'recordDecision', decision: { summary: 'd', rationale: 'r', ts: 2 }, jobId: 'job-1' },
        {
          op: 'recordFailure',
          failure: { tool: 'Bash', signature: 'sig', hint: 'h', ts: 3 },
          jobId: 'job-1',
        },
        {
          op: 'relateEntities',
          from: { name: 'zora', kind: 'project' },
          to: { name: 'alice', kind: 'person' },
          kind: 'owned_by',
        },
      ]);

      expect(store.stats()).toEqual({ entities: 2, tasks: 1, decisions: 1, failures: 1 });
    });

    it('skips a bad write instead of aborting the batch', () => {
      store.applyWrites([
        { op: 'recordTask', task: { jobId: '', summary: 's', outcome: 'ok', ts: 1 } },
        { op: 'upsertEntity', entity: { name: 'survivor', kind: 'concept' } },
      ]);
      expect(store.stats()).toMatchObject({ tasks: 0, entities: 1 });
    });
  });
});
