import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const db = SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'spa4-')));
const q=c=>db.execute(c);

// edge WITH properties, created 3x
q('CREATE (:P {name:"A"})'); q('CREATE (:P {name:"B"})');
for (let i=0;i<3;i++) q('MATCH (a:P {name:"A"}), (b:P {name:"B"}) CREATE (a)-[r:R {w: 1}]->(b)');
console.log('prop-edge 3x CREATE -> traversal rows:', q('MATCH (a:P)-[r:R]->(b) RETURN b.name, r.w').rows.length);
console.log('                       count(r)      :', JSON.stringify(q('MATCH (a:P)-[r:R]->(b) RETURN count(r)').rows));

// MERGE on edge with properties
q('MATCH (a:P {name:"A"}), (b:P {name:"B"}) MERGE (a)-[r:M {w: 7}]->(b)');
console.log('MERGE edge props preserved?          :', JSON.stringify(q('MATCH (a:P)-[r:M]->(b) RETURN r.w').rows));

// ORDER BY in traversal context / with LIMIT / on edge prop
for (const ts of [50,10,40,20,30]) q(`CREATE (:T {ts: ${ts}, name: "n${ts}"})`);
console.log('ORDER BY + LIMIT 3                   :', JSON.stringify(q('MATCH (n:T) RETURN n.ts ORDER BY n.ts LIMIT 3').rows.map(r=>r['n.ts'])));
console.log('ORDER BY on 2nd col                  :', JSON.stringify(q('MATCH (n:T) RETURN n.name, n.ts ORDER BY n.ts').rows.map(r=>r['n.ts'])));
for (const w of [5,1,4,2,3]) { q(`CREATE (:E {w:${w}})`); }
q('MATCH (a:P {name:"A"}), (b:P {name:"B"}) CREATE (a)-[r:W {w: 9}]->(b)');
console.log('ORDER BY on traversal result         :', JSON.stringify(q('MATCH (a:P)-[r]->(b) RETURN b.name, r.w ORDER BY r.w').rows));

// ORDER BY string
console.log('ORDER BY string                      :', JSON.stringify(q('MATCH (n:T) RETURN n.name ORDER BY n.name').rows.map(r=>r['n.name'])));

// collision: same prop name, query order reversed
q('CREATE (:N {kind:"nodeval"})');
q('MATCH (a:N), (b:N) CREATE (a)-[r:REL {kind:"edgeval"}]->(b)');
console.log('collision r.kind FIRST               :', JSON.stringify(q('MATCH (a:N)-[r:REL]->(b) RETURN r.kind, b.kind').rows));
console.log('collision a.kind + r.kind            :', JSON.stringify(q('MATCH (a:N)-[r:REL]->(b) RETURN a.kind, r.kind').rows));
