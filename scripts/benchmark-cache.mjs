/** Local indexed-cache benchmark; does not benchmark clinical scoring or a cloud tier. */
import { performance } from 'node:perf_hooks';
import { mkdirSync,writeFileSync } from 'node:fs';
import { LocalD1 } from '../tests/helpers/d1.mjs';
import { workflow } from '../lib/workflow-store.mjs';

const db=new LocalD1(),owner='benchmark:synthetic',date='2026-10-27',revision='benchmark-v1';
try {
  const scores=Array.from({length:10000},(_,i)=>({seniorId:`S${String(i+1).padStart(5,'0')}`,payload:{id:`S${String(i+1).padStart(5,'0')}`,score:i%97,level:i%97>=60?'high':'low',date,synthetic:true}}));
  const writeStart=performance.now();
  await workflow(db,'scores_put',{owner,date,revision,scores,computedAt:new Date().toISOString()});
  const writeMs=performance.now()-writeStart;
  const query=db.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM care_daily_scores WHERE owner = ? AND score_date = ? AND revision = ? AND senior_id > ? ORDER BY senior_id LIMIT ?').all(owner,date,revision,'',250);
  const samples=[];
  for(let iteration=0;iteration<50;iteration++) {
    const start=performance.now();
    const page=await workflow(db,'scores_get',{owner,date,revision,cursor:`S${String((iteration%40)*250).padStart(5,'0')}`,limit:250});
    if(page.length!==250)throw new Error('Expected a complete indexed page.');
    samples.push(performance.now()-start);
  }
  let cursor='',readRows=0,pages=0;const scanStart=performance.now();
  while(true){const page=await workflow(db,'scores_get',{owner,date,revision,cursor,limit:250});if(!page.length)break;readRows+=page.length;pages++;cursor=page.at(-1).senior_id;}
  const scanMs=performance.now()-scanStart;
  samples.sort((a,b)=>a-b);
  const result={syntheticCachedSeniors:10000,readRows,pages,pageSize:250,iterations:samples.length,insertMs:Math.round(writeMs*100)/100,medianPageMs:Math.round(samples[Math.floor(samples.length/2)]*1000)/1000,p95PageMs:Math.round(samples[Math.floor(samples.length*0.95)]*1000)/1000,allPagesMs:Math.round(scanMs*100)/100,queryPlan:query.map(r=>r.detail),environment:{node:process.version,platform:process.platform,storage:'Node SQLite in-memory, authored local schema'},limitations:'This tests bounded indexed reads of precomputed compact cache rows. It does not establish model throughput, production concurrency, cloud latency, storage growth, clinical accuracy or free-tier affordability for 10,000 people.'};
  if(readRows!==10000)throw new Error('Pagination lost benchmark rows.');
  mkdirSync('outputs',{recursive:true});writeFileSync('outputs/cache-benchmark.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{db.close();}
