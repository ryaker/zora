import pkg from 'sparrowdb';
const { SparrowDB } = pkg;
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-probe-'));
const db = SparrowDB.open(dir);

const results = [];
function t(name, fn) {
  try {
    const out = fn();
    results.push({ name, ok: true, out: JSON.stringify(out)?.slice(0, 300) });
  } catch (e) {
    results.push({ name, ok: false, err: String(e.message ?? e).slice(0, 300) });
  }
}
const q = (c) => db.execute(c);

// --- baseline ---
t('CREATE node', () => q('CREATE (:Person {name: "Alice", age: 30})'));
t('MATCH RETURN prop', () => q('MATCH (n:Person) RETURN n.name, n.age'));
t('MATCH RETURN node', () => q('MATCH (n:Person) RETURN n'));
t('id()/labels()', () => q('MATCH (n:Person) RETURN id(n), labels(n)'));

// --- documented parser gaps: confirm still present ---
t('GAP? CREATE ... RETURN', () => q('CREATE (:Person {name: "Bob"}) RETURN 1'));
t('GAP? two CREATE clauses', () => q('CREATE (:Person {name: "C"}) CREATE (:Person {name: "D"})'));
t('GAP? CREATE edge w/o MATCH', () => q('CREATE (a:X {n:1})-[:R]->(b:Y {n:2})'));

// --- write verbs claimed in index.d.ts doc comment ---
t('MERGE', () => q('MERGE (:Person {name: "Alice"})'));
t('SET node prop', () => q('MATCH (n:Person {name:"Alice"}) SET n.age = 31'));
t('SET verify', () => q('MATCH (n:Person {name:"Alice"}) RETURN n.age'));
t('DELETE node', () => q('MATCH (n:Person {name:"Bob"}) DELETE n'));
t('DETACH DELETE', () => q('MATCH (n:Person {name:"C"}) DETACH DELETE n'));
t('REMOVE prop', () => q('MATCH (n:Person {name:"Alice"}) REMOVE n.age'));

// --- edges ---
t('CREATE 2nd node', () => q('CREATE (:Person {name: "Bob2", age: 25})'));
t('CREATE edge via MATCH', () => q('MATCH (a:Person {name:"Alice"}), (b:Person {name:"Bob2"}) CREATE (a)-[r:KNOWS {since: 2020}]->(b)'));
t('traverse + edge prop', () => q('MATCH (a)-[r:KNOWS]->(b) RETURN a.name, b.name, r.since'));
t('SET edge prop retroactively', () => q('MATCH (a)-[r:KNOWS]->(b) SET r.strength = 0.9'));
t('varlen path [*1..3]', () => q('MATCH (a:Person {name:"Alice"})-[*1..3]->(b) RETURN b.name'));
t('undirected match', () => q('MATCH (a)-[r]-(b) RETURN a.name, b.name'));
t('OPTIONAL MATCH', () => q('OPTIONAL MATCH (n:Nope) RETURN n'));

// --- query features ---
t('WHERE + ORDER BY + LIMIT', () => q('MATCH (n:Person) WHERE n.age > 20 RETURN n.name ORDER BY n.name LIMIT 5'));
t('SKIP', () => q('MATCH (n:Person) RETURN n.name SKIP 1'));
t('COUNT aggregation', () => q('MATCH (n) RETURN labels(n), COUNT(*)'));
t('DISTINCT', () => q('MATCH ()-[r]->() RETURN DISTINCT type(r)'));
t('WHERE on string equality', () => q('MATCH (n:Person) WHERE n.name = "Alice" RETURN n.name'));
t('WHERE CONTAINS', () => q('MATCH (n:Person) WHERE n.name CONTAINS "lic" RETURN n.name'));
t('WHERE STARTS WITH', () => q('MATCH (n:Person) WHERE n.name STARTS WITH "Al" RETURN n.name'));
t('AND/OR', () => q('MATCH (n:Person) WHERE n.age > 1 AND n.name = "Bob2" RETURN n.name'));
t('NULL check IS NOT NULL', () => q('MATCH (n:Person) WHERE n.age IS NOT NULL RETURN n.name'));

// --- parameters (the big one) ---
t('PARAM: $-binding 2nd arg', () => db.execute('MATCH (n:Person {name: $name}) RETURN n.name', { name: 'Alice' }));
t('PARAM: $ in query, no binding', () => q('MATCH (n:Person {name: $name}) RETURN n.name'));

// --- string/escaping/injection behaviour ---
t('ESC: value with double quote', () => q('CREATE (:Note {body: "he said \\"hi\\""})'));
t('ESC: read back quoted value', () => q('MATCH (n:Note) RETURN n.body'));
t('ESC: single-quoted literal', () => q("CREATE (:Note {body: 'single'})"));
t('ESC: backslash in value', () => q('CREATE (:Note {body: "a\\\\b"})'));
t('ESC: newline in value', () => q('CREATE (:Note {body: "line1\nline2"})'));
t('ESC: unicode/emoji', () => q('CREATE (:Note {body: "héllo 🐦"})'));
t('INJECT: naive concat breakout', () => {
  const evil = '"}) CREATE (:Pwned {x: "1';           // what a naive caller would interpolate
  return q(`CREATE (:Note {body: "${evil}"})`);
});
t('INJECT: did :Pwned appear?', () => q('MATCH (n:Pwned) RETURN COUNT(*)'));

// --- types ---
t('TYPE: float prop', () => q('CREATE (:T {f: 1.5})'));
t('TYPE: bool prop', () => q('CREATE (:T {b: true})'));
t('TYPE: null prop', () => q('CREATE (:T {n: null})'));
t('TYPE: negative int', () => q('CREATE (:T {i: -42})'));
t('TYPE: list prop', () => q('CREATE (:T {l: [1,2,3]})'));
t('TYPE: read back', () => q('MATCH (n:T) RETURN n.f, n.b, n.i'));

// --- transactions (documented as unimplemented) ---
t('TX: beginRead()', () => { const r = db.beginRead(); return { snapshotTxnId: r.snapshotTxnId }; });
t('TX: ReadTx.execute()', () => db.beginRead().execute('MATCH (n) RETURN n'));
t('TX: beginWrite()', () => { const w = db.beginWrite(); w.rollback(); return 'ok'; });
t('TX: WriteTx.execute()', () => { const w = db.beginWrite(); try { return w.execute('CREATE (:Z)'); } finally { try { w.rollback(); } catch {} } });
t('TX: two concurrent writers', () => { const a = db.beginWrite(); try { const b = db.beginWrite(); b.rollback(); return 'second writer allowed'; } finally { a.rollback(); } });

// --- maintenance ---
t('CHECKPOINT stmt', () => q('CHECKPOINT'));
t('checkpoint()', () => db.checkpoint());
t('optimize()', () => db.optimize());

// --- error quality ---
t('ERR: syntax error message', () => q('MATCH (n RETURN n'));
t('ERR: unknown function', () => q('MATCH (n) RETURN nosuchfn(n)'));

// --- reopen / durability ---
t('REOPEN: second handle same path', () => { const d2 = SparrowDB.open(dir); return d2.execute('MATCH (n:Person) RETURN COUNT(*)'); });

console.log(JSON.stringify({ dir, results }, null, 1));
