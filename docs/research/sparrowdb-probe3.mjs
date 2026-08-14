import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const db = SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'spa3-')));
const q=c=>db.execute(c);

// ORDER BY numeric
for (const ts of [50, 10, 40, 20, 30]) q(`CREATE (:Ev {ts: ${ts}})`);
console.log('ORDER BY ts ASC :', JSON.stringify(q('MATCH (n:Ev) RETURN n.ts ORDER BY n.ts').rows.map(r=>r['n.ts'])));
console.log('ORDER BY ts DESC:', JSON.stringify(q('MATCH (n:Ev) RETURN n.ts ORDER BY n.ts DESC').rows.map(r=>r['n.ts'])));

// arrow direction
q('CREATE (:P {name:"A"})'); q('CREATE (:P {name:"B"})');
q('MATCH (a:P {name:"A"}), (b:P {name:"B"}) CREATE (a)-[r:LIKES]->(b)');
console.log('outbound A->B  :', JSON.stringify(q('MATCH (a:P {name:"A"})-[r:LIKES]->(b) RETURN b.name').rows));
console.log('INBOUND  A<-B  :', JSON.stringify(q('MATCH (a:P {name:"A"})<-[r:LIKES]-(b) RETURN b.name').rows));

// CREATE edge idempotency
q('MATCH (a:P {name:"A"}), (b:P {name:"B"}) CREATE (a)-[r:LIKES]->(b)');
q('MATCH (a:P {name:"A"}), (b:P {name:"B"}) CREATE (a)-[r:LIKES]->(b)');
console.log('after 3x CREATE, traversal rows:', q('MATCH (a:P {name:"A"})-[r:LIKES]->(b) RETURN b.name').rows.length);
console.log('but count(r) reports          :', JSON.stringify(q('MATCH (a:P)-[r:LIKES]->(b) RETURN count(r)').rows));

// node/edge property name collision
q('CREATE (:N {kind: "nodeval"})');
q('MATCH (a:N), (b:N) CREATE (a)-[r:REL {kind: "edgeval"}]->(b)');
console.log('collision b.kind vs r.kind    :', JSON.stringify(q('MATCH (a:N)-[r:REL]->(b) RETURN b.kind, r.kind').rows));
