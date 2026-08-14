import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const db = SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'spa23b-')));
const R=[]; const t=(n,f)=>{try{R.push([1,n,JSON.stringify(f())?.slice(0,160)])}catch(e){R.push([0,n,String(e.message??e).slice(0,160)])}};
const q=c=>db.execute(c); const p=(c,pr)=>db.executeWithParams(c,pr);

// seed REAL data via execute()
q('CREATE (:User {name: "Alice", role: "user"})');
q('CREATE (:User {name: "Bob", role: "user"})');

// --- parameterized READ path ---
t('READ param exact match', ()=>p('MATCH (n:User) WHERE n.name = $n RETURN n.name', {n:'Alice'}));
t('READ param injection in value', ()=>p('MATCH (n:User) WHERE n.name = $n RETURN n.name', {n:'" OR n.name <> "'}));
t('READ inline prop w/ param', ()=>p('MATCH (n:User {name: $n}) RETURN n.name', {n:'Bob'}));
t('READ unbound $param (execute)', ()=>q('MATCH (n:User) WHERE n.name = $nope RETURN n.name'));
t('READ missing key in params', ()=>p('MATCH (n:User) WHERE n.name = $missing RETURN n.name', {other:1}));

// --- parameterized WRITE paths ---
t('WRITE MERGE w/ param', ()=>p('MERGE (:Tag {name: $n})', {n:'", evil: "yes'}));
t('WRITE MERGE injected prop?', ()=>q('MATCH (n:Tag) RETURN n.name, n.evil'));
t('WRITE MATCH..SET w/ param', ()=>p('MATCH (n:User {name:"Alice"}) SET n.role = $r', {r:'", admin: "true'}));
t('WRITE SET injected prop?', ()=>q('MATCH (n:User {name:"Alice"}) RETURN n.role, n.admin'));
t('WRITE CREATE w/ param', ()=>p('CREATE (:New {v: $v})', {v:'x'}));

// --- type fidelity through params ---
t('TYPE via MERGE int/bool/float', ()=>{p('MERGE (:T2 {i: $i})',{i:42}); p('MERGE (:T3 {b: $b})',{b:true}); p('MERGE (:T4 {f: $f})',{f:1.5}); return q('MATCH (n:T2) RETURN n.i');});
t('TYPE bool via param readback', ()=>q('MATCH (n:T3) RETURN n.b'));
t('TYPE special chars via MERGE', ()=>{p('MERGE (:Esc {v: $v})',{v:'a"b\\c\nd'}); return q('MATCH (n:Esc) RETURN n.v');});
for(const [ok,n,v] of R) console.log(ok?'PASS ':'FAIL ', n.padEnd(30), v);
