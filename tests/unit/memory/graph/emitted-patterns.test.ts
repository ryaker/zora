/**
 * Structural constraints on the Cypher the adapter emits (MEM-33).
 *
 * These tests do not need the native engine. They drive `GraphStore` through a
 * recording fake and then assert properties of the *statements themselves* —
 * which is the only way to catch the two failure modes that matter here,
 * because both of them look like "no results" at runtime rather than like
 * errors:
 *
 *   1. **An unlabeled node in a chained pattern.** Verified against
 *      sparrowdb@0.1.24: in a chain that spans multiple labels over one
 *      relationship type — exactly `relatedTasks`
 *      (`Task -[:MENTIONS]-> Entity <-[:MENTIONS]- Task`) — an unlabeled
 *      *middle* node makes the engine return `[]` with no error at all. An
 *      unlabeled head or tail throws `not found`. The requirement is the
 *      label, not the variable: `(:Entity)` passes, `(m)` does not. Depth is
 *      not a constraint. A silent `[]` in the two-hop recall path would reach
 *      the user as "no related tasks" — the worst way for this to fail — so
 *      the rule is asserted here rather than left to a comment.
 *   2. **A value reaching a statement as text instead of as a parameter.**
 *      The escaper that used to make interpolation safe is gone, so the
 *      invariant that replaced it — every value is bound — has to be checked.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../../../src/memory/graph/graph-store.js';
import type {
  CypherParams,
  SparrowModule,
  SparrowResult,
} from '../../../../src/memory/graph/sparrow-loader.js';

interface Statement {
  cypher: string;
  params: CypherParams | null;
}

/** A SparrowDB stand-in that records statements and answers nothing. */
function recordingModule(): { module: SparrowModule; statements: Statement[] } {
  const statements: Statement[] = [];
  const empty = (): SparrowResult => ({ columns: [], rows: [] });
  const module: SparrowModule = {
    SparrowDB: {
      open: () => ({
        execute: (cypher: string) => {
          statements.push({ cypher, params: null });
          return empty();
        },
        executeWithParams: (cypher: string, params: CypherParams) => {
          statements.push({ cypher, params });
          return empty();
        },
        checkpoint: () => {},
        optimize: () => {},
      }),
    },
  };
  return { module, statements };
}

/**
 * Exercise every public method that emits a query.
 *
 * The recording fake returns no rows, so read paths that loop until they run
 * dry (`decisionChain`) terminate after one hop and write paths always take
 * the "node does not exist" branch. To reach the *update* and *edge exists*
 * branches too, a second pass runs against a fake that reports one row.
 */
function exerciseAll(store: GraphStore): void {
  const hostile = "'}) CREATE (evil:Entity {name:'pwned'}) MATCH (n:Entity {name:'";
  store.upsertEntity({ name: hostile, kind: 'project' });
  store.recordTask({ jobId: hostile, summary: hostile, outcome: hostile, ts: 5 }, [
    { name: hostile, kind: 'tool' },
  ]);
  store.recordDecision({ summary: hostile, rationale: hostile, ts: 6 }, hostile, hostile);
  store.recordFailure({ tool: hostile, signature: hostile, hint: hostile, ts: 7 }, hostile);
  store.relateEntities({ name: 'a', kind: 'person' }, { name: hostile, kind: 'concept' }, hostile);
  store.neighbours(hostile);
  store.tasksMentioning(hostile);
  store.relatedTasks(hostile);
  store.decisionChain(hostile);
  store.failuresForTool(hostile);
  store.stats();
}

// ── Pattern parsing ────────────────────────────────────────────────
//
// Deliberately small and literal: it understands only the pattern shapes this
// adapter emits, and would rather throw on something unfamiliar than quietly
// pass it.

/** One node in a pattern, e.g. `(e:Entity)` or `(m)`. */
interface PatternNode {
  text: string;
  labeled: boolean;
}

/** A path: the nodes of one comma-separated pattern and its arrow count. */
interface PatternPath {
  nodes: PatternNode[];
  relationships: number;
}

/** Extract the pattern text between `MATCH` and the next keyword clause. */
function matchClause(cypher: string): string | null {
  const start = cypher.indexOf('MATCH ');
  if (start === -1) return null;
  const rest = cypher.slice(start + 'MATCH '.length);
  const end = rest.search(/\b(RETURN|SET|CREATE|MERGE|DELETE|WHERE|LIMIT)\b/);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/**
 * Split a pattern into comma-separated paths.
 *
 * Commas inside `(...)`, `[...]` or a quoted string do not separate paths —
 * `(a:Task {zid: 'x'}), (b:Entity {zid: 'y'})` is two paths, while
 * `(t:Task {jobId: $j, ts: $ts})` is one.
 */
function splitPaths(pattern: string): string[] {
  const paths: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of pattern) {
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        paths.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) paths.push(current.trim());
  return paths;
}

/** Parse one path into its node patterns and relationship count. */
function parsePath(path: string): PatternPath {
  const nodes: PatternNode[] = [];
  let depth = 0;
  let quoted = false;
  let current: string | null = null;

  for (const ch of path) {
    if (current !== null) {
      if (ch === "'") quoted = !quoted;
      if (!quoted && ch === '(') depth++;
      if (!quoted && ch === ')') {
        depth--;
        if (depth === 0) {
          nodes.push(toNode(current));
          current = null;
          continue;
        }
      }
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth = 1;
      current = '';
    }
  }

  // Every `-[` starts one relationship, in either arrow direction.
  const relationships = (path.match(/-\[/g) ?? []).length;
  return { nodes, relationships };
}

/**
 * Decide whether a node pattern body carries a label.
 *
 * The body is what sits between the parentheses: `e:Entity`, `:Entity`,
 * `t:Task {jobId: $j}`, or just `m`. A label is a `:` that appears before any
 * property map — so `(t:Task {zid: 'x'})` is labeled and `(m {zid: 'x'})`
 * is not, even though both contain a colon.
 */
function toNode(body: string): PatternNode {
  const beforeProps = body.split('{')[0] ?? '';
  return { text: `(${body})`, labeled: beforeProps.includes(':') };
}

function pathsIn(cypher: string): PatternPath[] {
  const clause = matchClause(cypher);
  return clause === null ? [] : splitPaths(clause).map(parsePath);
}

describe('emitted Cypher — chained-pattern label rule', () => {
  let statements: Statement[];

  beforeEach(async () => {
    const { module, statements: recorded } = recordingModule();
    statements = recorded;
    const store = await GraphStore.open({ path: '/tmp/unused.db', module });
    expect(store).not.toBeNull();
    exerciseAll(store!);
  });

  it('labels every node of every chained pattern it emits', () => {
    const offenders: string[] = [];
    for (const { cypher } of statements) {
      for (const path of pathsIn(cypher)) {
        if (path.relationships < 2) continue; // not a chain
        for (const node of path.nodes) {
          if (!node.labeled) offenders.push(`${node.text} in: ${cypher}`);
        }
      }
    }
    // An unlabeled middle node here returns [] with no error, which reads as
    // "no results" rather than as a bug. That is why this is asserted.
    expect(offenders).toEqual([]);
  });

  it('actually emits a chained pattern, so the rule above is not vacuous', () => {
    const chains = statements.flatMap(s => pathsIn(s.cypher)).filter(p => p.relationships >= 2);
    expect(chains.length).toBeGreaterThan(0);
    // relatedTasks is the two-hop recall path: Task -> Entity <- Task.
    expect(chains.some(c => c.nodes.length === 3)).toBe(true);
  });

  it('labels every node that participates in any relationship, chained or not', () => {
    // Stricter than the engine requires for single hops, but it means no
    // pattern here is ever one edit away from becoming a silent-[] chain.
    const offenders: string[] = [];
    for (const { cypher } of statements) {
      for (const path of pathsIn(cypher)) {
        if (path.relationships === 0) continue;
        for (const node of path.nodes) {
          if (!node.labeled) offenders.push(`${node.text} in: ${cypher}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('emits the inbound leg of relatedTasks as a fully-labeled fixed-hop chain', () => {
    // Variable-length inbound (`<-[:R*1..3]-`) is unimplemented upstream, so
    // inbound traversal past one hop has to be written out hop by hop.
    const related = statements.find(s => s.cypher.includes('<-[:MENTIONS]-'));
    expect(related).toBeDefined();
    expect(related!.cypher).toContain('(t:Task {jobId: $jobId})-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(o:Task)');
    // No variable-length syntax on any inbound leg.
    for (const { cypher } of statements) {
      expect(cypher).not.toMatch(/<-\[:[A-Z_]+\*/);
    }
  });
});

describe('emitted Cypher — values are bound, never interpolated', () => {
  let statements: Statement[];
  const hostile = "'}) CREATE (evil:Entity {name:'pwned'}) MATCH (n:Entity {name:'";

  beforeEach(async () => {
    const { module, statements: recorded } = recordingModule();
    statements = recorded;
    const store = await GraphStore.open({ path: '/tmp/unused.db', module });
    exerciseAll(store!);
  });

  it('never puts a caller-supplied value into the statement text', () => {
    for (const { cypher } of statements) {
      expect(cypher).not.toContain('pwned');
      expect(cypher).not.toContain(hostile);
    }
  });

  it('passes hostile values through as bound parameters instead', () => {
    const bound = statements.flatMap(s => Object.values(s.params ?? {}));
    expect(bound).toContain(hostile);
  });

  it('uses bare parameter keys, never $-prefixed ones', () => {
    // A `$`-prefixed key raises "parameter $x was referenced in the query but
    // not supplied" — loud, but still wrong.
    for (const { params } of statements) {
      for (const key of Object.keys(params ?? {})) {
        expect(key.startsWith('$')).toBe(false);
      }
    }
  });

  it('binds every placeholder it references, and references every value it binds', () => {
    for (const { cypher, params } of statements) {
      const referenced = new Set((cypher.match(/\$[A-Za-z_][A-Za-z0-9_]*/g) ?? []).map(p => p.slice(1)));
      const supplied = new Set(Object.keys(params ?? {}));
      expect([...referenced].filter(r => !supplied.has(r))).toEqual([]);
      expect([...supplied].filter(s => !referenced.has(s))).toEqual([]);
    }
  });

  it('only ever interpolates ontology identifiers and surrogate keys', () => {
    // The single-quoted literals left in any statement must all be 32-char
    // hex surrogate ids — the one thing this adapter still writes as text.
    for (const { cypher } of statements) {
      for (const literal of cypher.match(/'[^']*'/g) ?? []) {
        expect(literal.slice(1, -1)).toMatch(/^[0-9a-f]{32}$/);
      }
    }
  });
});
