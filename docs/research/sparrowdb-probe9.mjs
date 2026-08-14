import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const mk=()=>SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'s24d-')));
const R=(db,c)=>{ try{ return JSON.stringify(db.execute(c).rows); }catch(e){ return 'THREW: '+String(e.message).slice(0,40); } };

// Fixture 1: multi-label, same rel type   A -R-> B -R-> C
{ const db=mk();
  db.execute('CREATE (:A {v:1})'); db.execute('CREATE (:B {v:2})'); db.execute('CREATE (:C {v:3})');
  db.execute('MATCH (a:A),(b:B) CREATE (a)-[r:R]->(b)');
  db.execute('MATCH (b:B),(c:C) CREATE (b)-[r:R]->(c)');
  console.log('FIXTURE 1  multi-label, same rel type (expect x.v=3)');
  console.log('  all labeled    ', R(db,'MATCH (a:A)-[:R]->(m:B)-[:R]->(x:C) RETURN x.v'));
  console.log('  mid unlabeled  ', R(db,'MATCH (a:A)-[:R]->(m)-[:R]->(x:C) RETURN x.v'));
  console.log('  tail unlabeled ', R(db,'MATCH (a:A)-[:R]->(m:B)-[:R]->(x) RETURN x.v'));
  console.log('  both unlabeled ', R(db,'MATCH (a:A)-[:R]->(m)-[:R]->(x) RETURN x.v'));
}
// Fixture 2: single label, different rel types   N -R1-> N -R2-> N
{ const db=mk();
  db.execute('CREATE (:N {v:1})'); db.execute('CREATE (:N {v:2})'); db.execute('CREATE (:N {v:3})');
  db.execute('MATCH (a:N {v:1}),(b:N {v:2}) CREATE (a)-[r:R1]->(b)');
  db.execute('MATCH (b:N {v:2}),(c:N {v:3}) CREATE (b)-[r:R2]->(c)');
  console.log('FIXTURE 2  single-label, diff rel types (expect x.v=3)');
  console.log('  all labeled    ', R(db,'MATCH (a:N {v:1})-[:R1]->(m:N)-[:R2]->(x:N) RETURN x.v'));
  console.log('  mid unlabeled  ', R(db,'MATCH (a:N {v:1})-[:R1]->(m)-[:R2]->(x:N) RETURN x.v'));
  console.log('  tail unlabeled ', R(db,'MATCH (a:N {v:1})-[:R1]->(m:N)-[:R2]->(x) RETURN x.v'));
}
