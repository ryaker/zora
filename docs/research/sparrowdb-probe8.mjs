import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const db=SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'s24c-')));
const R=c=>{ try{ return JSON.stringify(db.execute(c).rows); }catch(e){ return 'THREW: '+String(e.message).slice(0,55); } };
db.execute('CREATE (:A {v:1})'); db.execute('CREATE (:B {v:2})'); db.execute('CREATE (:C {v:3})');
db.execute('MATCH (a:A),(b:B) CREATE (a)-[r:R]->(b)');
db.execute('MATCH (b:B),(c:C) CREATE (b)-[r:R]->(c)');
const cases=[
 ['anon intermediate  ()','MATCH (a:A)-[:R]->()-[:R]->(x) RETURN x.v'],
 ['named intermediate (m)','MATCH (a:A)-[:R]->(m)-[:R]->(x) RETURN x.v'],
 ['named+labelled (m:B)','MATCH (a:A)-[:R]->(m:B)-[:R]->(x) RETURN x.v'],
 ['named rel vars','MATCH (a:A)-[r1:R]->(m)-[r2:R]->(x) RETURN x.v'],
 ['varlen *2..2','MATCH (a:A)-[:R*2..2]->(x) RETURN x.v'],
 ['varlen *1..3','MATCH (a:A)-[:R*1..3]->(x) RETURN x.v'],
 ['varlen inbound *1..3','MATCH (c:C)<-[:R*1..3]-(x) RETURN x.v'],
 ['1hop named intermediate','MATCH (a:A)-[:R]->(m) RETURN m.v'],
];
for(const [n,q] of cases) console.log(n.padEnd(26), R(q));
