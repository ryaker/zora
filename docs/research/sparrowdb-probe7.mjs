import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const mk=()=>SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'spadel3-')));
// ---- DETACH DELETE, row-based oracle ----
{ const db=mk(); const q=c=>db.execute(c);
  q('CREATE (:A {v:1})'); q('CREATE (:B {v:2})');
  q('MATCH (a:A),(b:B) CREATE (a)-[r:R]->(b)');
  console.log('before      : A rows', JSON.stringify(q('MATCH (n:A) RETURN n.v').rows), 'edges', JSON.stringify(q('MATCH (x)-[r]->(y) RETURN x.v,y.v').rows));
  q('MATCH (n:A) DETACH DELETE n');
  console.log('after DETACH: A rows', JSON.stringify(q('MATCH (n:A) RETURN n.v').rows), 'edges', JSON.stringify(q('MATCH (x)-[r]->(y) RETURN x.v,y.v').rows));
}
// ---- ungrouped vs grouped count, nodes and edges ----
{ const db=mk(); const q=c=>db.execute(c);
  for(const v of [1,2,3]) q(`CREATE (:N {v:${v}})`);
  q('MATCH (n:N {v:1}) DELETE n');
  console.log('\nnodes rows        :', JSON.stringify(q('MATCH (n:N) RETURN n.v').rows.length));
  console.log('ungrouped COUNT(*):', JSON.stringify(q('MATCH (n:N) RETURN COUNT(*)').rows));
  console.log('grouped   COUNT(*):', JSON.stringify(q('MATCH (n:N) RETURN labels(n), COUNT(*)').rows));
  console.log('count(n)          :', JSON.stringify(q('MATCH (n:N) RETURN count(n)').rows));
  console.log('COUNT w/ WHERE    :', JSON.stringify(q('MATCH (n:N) WHERE n.v > 0 RETURN COUNT(*)').rows));
}
