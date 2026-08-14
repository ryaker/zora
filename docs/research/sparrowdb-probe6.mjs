import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const mk=()=>SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'spa23d-')));
// --- arrow direction, fresh db, no deletes ---
{ const db=mk(); const q=c=>db.execute(c);
  q('CREATE (:A {n:1})'); q('CREATE (:B {n:2})');
  q('MATCH (a:A),(b:B) CREATE (a)-[r:R]->(b)');   // A -> B
  console.log('A->B outbound from A (expect n=2):', JSON.stringify(q('MATCH (a:A)-[r:R]->(x) RETURN x.n').rows));
  console.log('inbound INTO A   (expect EMPTY)  :', JSON.stringify(q('MATCH (a:A)<-[r:R]-(x) RETURN x.n').rows));
  console.log('inbound INTO B   (expect n=1)    :', JSON.stringify(q('MATCH (b:B)<-[r:R]-(x) RETURN x.n').rows));
  console.log('outbound from B  (expect EMPTY)  :', JSON.stringify(q('MATCH (b:B)-[r:R]->(x) RETURN x.n').rows));
}
// --- DETACH DELETE, fresh db ---
{ const db=mk(); const q=c=>db.execute(c);
  q('CREATE (:A {n:1})'); q('CREATE (:B {n:2})');
  q('MATCH (a:A),(b:B) CREATE (a)-[r:R]->(b)');
  console.log('\nbefore: A count', JSON.stringify(q('MATCH (n:A) RETURN COUNT(*)').rows), 'edges', JSON.stringify(q('MATCH ()-[r]->() RETURN COUNT(*)').rows));
  q('MATCH (n:A) DETACH DELETE n');
  console.log('after : A count', JSON.stringify(q('MATCH (n:A) RETURN COUNT(*)').rows), 'edges', JSON.stringify(q('MATCH ()-[r]->() RETURN COUNT(*)').rows));
  q('CREATE (:C {n:9})');
  q('MATCH (n:C) DELETE n');
  console.log('plain DELETE on unconnected C   :', JSON.stringify(q('MATCH (n:C) RETURN COUNT(*)').rows));
}
