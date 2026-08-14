import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const mk=()=>SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'edge-')));
const R=(db,c)=>{try{return JSON.stringify(db.execute(c).rows)}catch(e){return 'THREW: '+String(e.message).slice(0,45)}};
const P=(db,c,p)=>{try{return JSON.stringify(db.executeWithParams(c,p).rows)}catch(e){return 'THREW: '+String(e.message).slice(0,45)}};

// baseline: NON-parameterized edge create
{ const db=mk();
  db.executeWithParams('CREATE (:A {k: $k})',{k:'a1'});
  db.executeWithParams('CREATE (:B {k: $k})',{k:'b1'});
  console.log('nodes created        ', R(db,'MATCH (n:A) RETURN n.k'), R(db,'MATCH (n:B) RETURN n.k'));
  console.log('edge via plain execute', R(db,"MATCH (a:A {k:'a1'}), (b:B {k:'b1'}) CREATE (a)-[:R]->(b)"));
  console.log('  edges present?     ', R(db,'MATCH (a:A)-[:R]->(b:B) RETURN b.k'));
}
// parameterized edge create
{ const db=mk();
  db.executeWithParams('CREATE (:A {k: $k})',{k:'a1'});
  db.executeWithParams('CREATE (:B {k: $k})',{k:'b1'});
  console.log('\nedge via PARAMS      ', P(db,'MATCH (a:A {k: $v}), (b:B {k: $w}) CREATE (a)-[:R]->(b)',{v:'a1',w:'b1'}));
  console.log('  edges present?     ', R(db,'MATCH (a:A)-[:R]->(b:B) RETURN b.k'));
  console.log('  any edge at all?   ', R(db,'MATCH (x)-[r]->(y) RETURN type(r)'));
}
// MERGE edge with params, and with empty params
{ const db=mk();
  db.executeWithParams('CREATE (:A {k: $k})',{k:'a1'});
  db.executeWithParams('CREATE (:B {k: $k})',{k:'b1'});
  console.log('\nMERGE edge w/ params ', P(db,'MATCH (a:A {k: $v}), (b:B {k: $w}) MERGE (a)-[:R]->(b)',{v:'a1',w:'b1'}));
  console.log('MERGE edge w/ {}     ', P(db,"MATCH (a:A {k:'a1'}), (b:B {k:'b1'}) MERGE (a)-[:R]->(b)",{}));
  console.log('plain CREATE w/ {}   ', P(db,"MATCH (a:A {k:'a1'}), (b:B {k:'b1'}) CREATE (a)-[:R]->(b)",{}));
  console.log('  edges present?     ', R(db,'MATCH (x)-[r]->(y) RETURN type(r)'));
}
