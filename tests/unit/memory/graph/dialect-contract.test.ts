/**
 * The SparrowDB dialect contract (MEM-35).
 *
 * `graph-store.ts` opens with a numbered list of engine quirks and explains
 * every design decision below it by reference to that list. The list was
 * written against 0.1.21, revised against 0.1.24, and revised again against
 * 0.1.26 — and each of those revisions found at least one claim that had
 * quietly stopped being true. A stale claim there is worse than no claim: the
 * next reader trusts it and writes around a bug that no longer exists, or
 * leaves in place a workaround whose absence would now be correct.
 *
 * So this file asserts the quirks themselves, directly against the engine,
 * with no adapter in between. It is not testing Zora. It is testing that the
 * comment block in `graph-store.ts` still describes the installed sparrowdb —
 * which makes a version bump a test run rather than a re-reading.
 *
 * A failure here does **not** mean Zora is broken. It means an upstream
 * behaviour changed and the header comment (and possibly the workaround it
 * justifies) needs revisiting. Each assertion names the quirk it guards.
 *
 * Skips when the native module is absent, like the other native-backed suites.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadSparrow, type SparrowDatabase } from '../../../../src/memory/graph/sparrow-loader.js';
import { isDatabaseLockedError } from '../../../../src/memory/graph/graph-owner.js';

const loaded = await loadSparrow();
const describeIfNative = (): typeof describe | typeof describe.skip =>
  loaded.available ? describe : describe.skip;

// Synchronous native calls under full-suite parallel load can outrun vitest's
// 5000 ms default; see the note in graph-store.test.ts (MEM-35). The spawned
// child process in the lock case needs headroom of its own.
describeIfNative()('sparrowdb dialect contract', { timeout: 30_000 }, () => {
  let tmpDir: string;
  let dbRoot: string;
  let db: SparrowDatabase;

  /** Run a statement and report whether it threw, without failing the test. */
  const attempt = (fn: () => unknown): { threw: false; value: unknown } | { threw: true; message: string } => {
    try {
      return { threw: false, value: fn() };
    } catch (err) {
      return { threw: true, message: err instanceof Error ? err.message : String(err) };
    }
  };
  const exec = (cypher: string): unknown => db.execute(cypher);
  const rows = (cypher: string): Array<Record<string, unknown>> => db.execute(cypher).rows;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zora-dialect-'));
    dbRoot = path.join(tmpDir, 'dialect.db');
    if (!loaded.available) return;
    db = loaded.module.SparrowDB.open(dbRoot);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('quirk 1 — a parameterized edge write binds no endpoints', () => {
    db.executeWithParams('CREATE (:L1 {k: $v})', { v: 'a' });
    db.executeWithParams('CREATE (:L2 {k: $w})', { w: 'b' });

    // The dangerous half: no error, no edge. If this ever starts creating the
    // edge, `_link`'s zid-pinned interpolation can be replaced by binding.
    db.executeWithParams('MATCH (a:L1 {k: $v}), (b:L2 {k: $w}) CREATE (a)-[:R]->(b)', {
      v: 'a',
      w: 'b',
    });
    expect(rows('MATCH (a:L1)-[:R]->(b:L2) RETURN b.k')).toEqual([]);

    // The loud half: the MERGE form refuses outright, even with no payload.
    const merged = attempt(() =>
      db.executeWithParams('MATCH (a:L1 {k: $v}), (b:L2 {k: $w}) MERGE (a)-[:R2]->(b)', {
        v: 'a',
        w: 'b',
      }),
    );
    expect(merged.threw).toBe(true);
    expect(merged.threw && merged.message).toMatch(/not yet supported/i);
  });

  it('quirk 2 — labels cannot be bound', () => {
    const result = attempt(() => db.executeWithParams('MATCH (n:$lbl) RETURN n.k', { lbl: 'L1' }));
    expect(result.threw).toBe(true);
    expect(result.threw && result.message).toMatch(/expected label\/type name/i);
  });

  it('quirk 3 — an unlabeled middle node silently returns nothing', () => {
    exec('CREATE (:Task {jobId: "j1"})');
    exec('CREATE (:Task {jobId: "j2"})');
    exec('CREATE (:Entity {name: "shared"})');
    exec('MATCH (a:Task {jobId: "j1"}), (b:Entity {name: "shared"}) MERGE (a)-[:MENTIONS]->(b)');
    exec('MATCH (a:Task {jobId: "j2"}), (b:Entity {name: "shared"}) MERGE (a)-[:MENTIONS]->(b)');

    const unlabeled = rows(
      'MATCH (a:Task {jobId: "j1"})-[:MENTIONS]->(m)<-[:MENTIONS]-(t:Task) RETURN t.jobId',
    );
    const labeled = rows(
      'MATCH (a:Task {jobId: "j1"})-[:MENTIONS]->(m:Entity)<-[:MENTIONS]-(t:Task) RETURN t.jobId',
    );

    // This is the pair that matters: same query, one label apart, and the
    // broken one returns [] rather than raising. `emitted-patterns.test.ts`
    // exists because of it.
    expect(unlabeled).toEqual([]);
    expect(labeled.length).toBeGreaterThan(0);
  });

  it('quirk 4 — variable-length inbound traversal is unimplemented', () => {
    const result = attempt(() => rows('MATCH (a:Entity)<-[:MENTIONS*1..3]-(t:Task) RETURN t.jobId'));
    expect(result.threw).toBe(true);
    expect(result.threw && result.message).toMatch(/not yet implemented/i);
  });

  it('quirk 5 — there are no transactions', () => {
    const tx = attempt(() => (db as unknown as { beginRead(): { execute(c: string): unknown } }).beginRead());
    // `beginRead()` may hand back a handle, but executing on it must not work —
    // if it ever does, the "every write is idempotent because it cannot be
    // atomic" argument in the adapter header is no longer forced.
    const executed = tx.threw
      ? tx
      : attempt(() => (tx.value as { execute(c: string): unknown }).execute('MATCH (n:Task) RETURN n.jobId'));
    expect(executed.threw).toBe(true);
  });

  it('quirk 6 — one clause per statement', () => {
    const twoCreates = attempt(() => exec('CREATE (:X {a: 1}) CREATE (:X {a: 2})'));
    expect(twoCreates.threw).toBe(true);

    const matchWhereCreate = attempt(() =>
      exec('MATCH (a:L1) WHERE a.k = "a" CREATE (a)-[:R3]->(a)'),
    );
    expect(matchWhereCreate.threw).toBe(true);
    expect(matchWhereCreate.threw && matchWhereCreate.message).toMatch(/expected RETURN/i);
  });

  it('quirk 7 — RETURN n yields hashed property keys, not a node reference', () => {
    const result = db.execute('MATCH (n:Entity) RETURN n');
    const first = result.rows[0] as Record<string, unknown> | undefined;
    expect(first).toBeDefined();
    const node = first?.['n'] as Record<string, unknown>;

    // Not the documented `{$type: 'node', id}`: an object whose keys are
    // hashes of the property names. Every read in the adapter projects
    // explicit properties because of this.
    expect(node).toBeTypeOf('object');
    expect(Object.keys(node).every((k) => /^col_\d+$/.test(k))).toBe(true);
    expect(Object.keys(node)).not.toContain('name');
  });

  it('quirk 8 — ORDER BY is correct, but a bare LIMIT truncates arbitrarily', () => {
    for (const i of [5, 1, 4, 2, 3]) db.executeWithParams('CREATE (:Ord {i: $i})', { i });

    // ORDER BY was broken on earlier versions and is not any more, so the
    // JS-side sort in the adapter is a scan-cap decision, not a workaround.
    expect(rows('MATCH (n:Ord) RETURN n.i ORDER BY n.i').map((r) => r['n.i'])).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(rows('MATCH (n:Ord) RETURN n.i ORDER BY n.i DESC LIMIT 2').map((r) => r['n.i'])).toEqual([
      5, 4,
    ]);

    // But an engine-side LIMIT over an unsorted scan is not "the first N by
    // any useful order" — which is why the adapter's LIMIT is a scan ceiling
    // and the caller's limit is applied after sorting.
    const bare = rows('MATCH (n:Ord) RETURN n.i LIMIT 2').map((r) => r['n.i']);
    expect(bare).toHaveLength(2);
    expect(bare).not.toEqual([1, 2]);
  });

  it('quirk 10 — edge properties cannot be edited in place', () => {
    const result = attempt(() => exec('MATCH (a:L1)-[r:R2]->(b:L2) SET r.x = "v" RETURN r.x'));
    expect(result.threw).toBe(true);
    expect(result.threw && result.message).toMatch(/single-node patterns/i);
  });

  it('quirk 11 — MERGE drops edge properties, and a replayed CREATE misbehaves', () => {
    exec('CREATE (:P {k: "p1"})');
    exec('CREATE (:P {k: "p2"})');

    // MERGE keeps one edge and silently throws the properties away.
    exec(`MATCH (a:P {k: 'p1'}), (b:P {k: 'p2'}) MERGE (a)-[:E1 {p: 'v'}]->(b)`);
    expect(rows('MATCH (a:P)-[r:E1]->(b:P) RETURN r.p')).toEqual([{ 'r.p': null }]);

    // A property-less CREATE, replayed, duplicates the edge — the reason
    // property-less edges go through MERGE.
    exec(`MATCH (a:P {k: 'p1'}), (b:P {k: 'p2'}) CREATE (a)-[:E2]->(b)`);
    exec(`MATCH (a:P {k: 'p1'}), (b:P {k: 'p2'}) CREATE (a)-[:E2]->(b)`);
    expect(rows('MATCH (a:P)-[r:E2]->(b:P) RETURN b.k')).toHaveLength(2);

    // A property-carrying CREATE, replayed, does NOT duplicate on 0.1.26 — it
    // overwrites. Either behaviour makes an unguarded replay wrong, which is
    // what `_link`'s existence check is for, but they are wrong in opposite
    // directions and the header comment names which one is current.
    exec(`MATCH (a:P {k: 'p1'}), (b:P {k: 'p2'}) CREATE (a)-[:E3 {p: 'v1'}]->(b)`);
    exec(`MATCH (a:P {k: 'p1'}), (b:P {k: 'p2'}) CREATE (a)-[:E3 {p: 'v2'}]->(b)`);
    expect(rows('MATCH (a:P)-[r:E3]->(b:P) RETURN r.p')).toEqual([{ 'r.p': 'v2' }]);
  });

  it('quirk 12 — null, arrays and booleans are not storable property values', () => {
    expect(attempt(() => exec('CREATE (:N {a: null})')).threw).toBe(true);
    expect(attempt(() => exec('CREATE (:N {a: [1,2]})')).threw).toBe(true);

    // Booleans are accepted and read back as 1/0, indistinguishable from
    // integers — which is why the adapter writes strings and numbers only.
    exec('CREATE (:Bo {flag: true})');
    expect(rows('MATCH (n:Bo) RETURN n.flag')).toEqual([{ 'n.flag': 1 }]);
  });

  it('an absent property reads as null, never as zero', () => {
    exec('CREATE (:Ab {a: 1})');
    // Earlier versions conflated "absent" with Int64(0), which would have made
    // every optional numeric field in the ontology a lie.
    expect(rows('MATCH (n:Ab) RETURN n.a, n.zzz')).toEqual([{ 'n.a': 1, 'n.zzz': null }]);
  });

  it('bound values are stored literally — the 0.1.21 injection stays closed', () => {
    db.executeWithParams('CREATE (:User {name: $name})', { name: '", role: "admin' });
    expect(rows('MATCH (n:User) RETURN n.name, n.role')).toEqual([
      { 'n.name': '", role: "admin', 'n.role': null },
    ]);
  });

  it('a $-prefixed parameter key fails loudly rather than binding', () => {
    const result = attempt(() => db.executeWithParams('CREATE (:D {v: $v})', { $v: 'x' }));
    expect(result.threw).toBe(true);
  });

  it('refuses a second process, and the refusal is the one Zora matches on', () => {
    // The reason for the 0.1.27 upgrade (SparrowDB #524). `beforeAll` still
    // holds an open handle on this root, so the child is a genuine concurrent
    // opener — the case that used to corrupt `catalog.tlv` silently.
    //
    // The child is spawned rather than faked because the value under test is
    // upstream's error *text*: `isDatabaseLockedError` matches on a substring,
    // and a test that fed it a string copied from this repo would pass forever
    // regardless of what the engine actually says.
    const entry = createRequire(import.meta.url).resolve('sparrowdb');
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `const {SparrowDB} = require(${JSON.stringify(entry)});
         try { SparrowDB.open(${JSON.stringify(dbRoot)}); console.log('OPENED'); }
         catch (e) { console.log('ERR:' + e.message); }`,
      ],
      { encoding: 'utf8' },
    );

    const output = child.stdout.trim();
    expect(output, `child stderr: ${child.stderr}`).toMatch(/^ERR:/);
    expect(isDatabaseLockedError(new Error(output.slice(4)))).toBe(true);

    // The engine's own lock file, alongside Zora's advisory one.
    expect(fsSync.existsSync(path.join(dbRoot, 'db.lock'))).toBe(true);
  });

  it('still lets this process open the same root twice', () => {
    // Upstream scopes the lock to the open file description and shares it
    // through a process-local registry. Zora needs that: the graph worker is a
    // thread, and several tests reopen a root they already hold.
    const second = attempt(() => loaded.available && loaded.module.SparrowDB.open(dbRoot));
    expect(second.threw).toBe(false);
  });
});
