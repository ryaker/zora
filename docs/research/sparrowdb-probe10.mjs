import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const db=SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'s24f-')));
const R=c=>{ try{ return JSON.stringify(db.execute(c).rows); }catch(e){ return 'THREW: '+String(e.message).slice(0,38); } };
db.execute('CREATE (:A {v:1})'); db.execute('CREATE (:B {v:2})'); db.execute('CREATE (:C {v:3})'); db.execute('CREATE (:D {v:4})');
db.execute('MATCH (a:A),(b:B) CREATE (a)-[r:R]->(b)');
db.execute('MATCH (b:B),(c:C) CREATE (b)-[r:R]->(c)');
db.execute('MATCH (c:C),(d:D) CREATE (c)-[r:R]->(d)');   // A->B->C->D
console.log('2-hop all labeled (expect 3):', R('MATCH (a:A)-[:R]->(m:B)-[:R]->(x:C) RETURN x.v'));
console.log('3-hop all labeled (expect 4):', R('MATCH (a:A)-[:R]->(m:B)-[:R]->(n:C)-[:R]->(y:D) RETURN y.v'));
console.log('varlen *1..3      (expect 2,3,4):', R('MATCH (a:A)-[:R*1..3]->(x) RETURN x.v'));
