import pkg from 'sparrowdb'; const { SparrowDB } = pkg;
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const db = SparrowDB.open(fs.mkdtempSync(path.join(os.tmpdir(),'spa2-')));
const R=[]; const t=(n,f)=>{try{R.push([1,n,JSON.stringify(f())?.slice(0,180)])}catch(e){R.push([0,n,String(e.message??e).slice(0,180)])}};
const q=c=>db.execute(c);

// property-injection inside a SINGLE clause (the vector the multi-CREATE gap does not block)
t('INJ: extra prop breakout', ()=>{ const evil = '", role: "admin'; return q(`CREATE (:User {name: "${evil}"})`); });
t('INJ: did role leak?', ()=>q('MATCH (n:User) RETURN n.name, n.role'));
t('INJ: label breakout via prop', ()=>{ const evil='"}) ; CREATE (:Pwn {a:"x'; return q(`CREATE (:U2 {v: "${evil}"})`); });
t('INJ: MATCH filter breakout', ()=>{ const evil='" OR n.name <> "'; return q(`MATCH (n:User) WHERE n.name = "${evil}" RETURN n.name`); });

// boolean round-trip
t('BOOL: create', ()=>q('CREATE (:B {flag: true, other: false})'));
t('BOOL: read back', ()=>q('MATCH (n:B) RETURN n.flag, n.other'));
t('BOOL: filter on true', ()=>q('MATCH (n:B) WHERE n.flag = true RETURN n.flag'));

// missing property: null or 0?
t('MISSING: node w/o prop', ()=>q('CREATE (:M {a: 1})'));
t('MISSING: RETURN absent prop', ()=>q('MATCH (n:M) RETURN n.a, n.zzz'));
t('MISSING: absent in edge ctx', ()=>q('MATCH (n:M) RETURN n.zzz, n.a'));

// whole-node return: property names
t('NODE: RETURN n columns', ()=>q('MATCH (n:M) RETURN n'));
t('NODE: RETURN n vs .d.ts NodeRef', ()=>q('MATCH (n:B) RETURN n'));

// string with only a quote / control chars
t('ESC: value = single dquote', ()=>q('CREATE (:S {v: "\\""})'));
t('ESC: read', ()=>q('MATCH (n:S) RETURN n.v'));
t('ESC: tab+CR', ()=>q('CREATE (:S2 {v: "a\\tb\\rc"})'));

// large-ish bulk + event loop block
t('BULK: 2000 inserts timing', ()=>{ const s=Date.now(); for(let i=0;i<2000;i++) q(`CREATE (:Bulk {i: ${i}, s: "n${i}"})`); return {ms: Date.now()-s}; });
t('BULK: checkpoint timing', ()=>{ const s=Date.now(); db.checkpoint(); return {ms: Date.now()-s}; });
t('BULK: scan 2000 timing', ()=>{ const s=Date.now(); const r=q('MATCH (n:Bulk) RETURN n.i'); return {ms: Date.now()-s, rows:r.rows.length}; });
t('BULK: optimize timing', ()=>{ const s=Date.now(); db.optimize(); return {ms: Date.now()-s}; });

// info-ish introspection
t('INTRO: labels+counts', ()=>q('MATCH (n) RETURN labels(n), COUNT(*)'));
t('INTRO: rel types', ()=>q('MATCH ()-[r]->() RETURN type(r), COUNT(*)'));

for(const [ok,n,v] of R) console.log(ok?'PASS ':'FAIL ', n.padEnd(30), v);
