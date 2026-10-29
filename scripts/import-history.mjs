/** Import the versioned fictional cohort without changing care events or accounts.
 * Default: prepare an ignored local archive. Use --import / --resume to persist;
 * --verify only reads. Authentication uses the existing ignored owner file.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {careModel,showcaseEnvironment} from '../lib/model-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=new Set(process.argv.slice(2));
if(args.has('--help')){
 console.log('node scripts/import-history.mjs [--prepare | --import | --resume | --verify]\nUses config/supabase.json and ignored outputs/owner-access.json.\n--prepare writes outputs/history-import.json. --verify does not import or alter history.');
 process.exit(0);
}
for(const arg of args)if(!['--prepare','--import','--resume','--verify'].includes(arg))throw Error('Unknown history import option. Use --help.');
const mode=args.has('--verify')?'verify':args.has('--import')||args.has('--resume')?'import':'prepare';
const {cohort,engine}=careModel(showcaseEnvironment({}));
const fingerprint=createHash('sha256').update(JSON.stringify({metadata:cohort.metadata,seniors:cohort.seniors,records:cohort.records})).digest('hex');
const manifest={datasetId:`${cohort.metadata.generator}:${cohort.metadata.startDate}:${cohort.metadata.endDate}:${fingerprint.slice(0,12)}`,fingerprint,
 generator:cohort.metadata.generator,startDate:cohort.metadata.startDate,endDate:cohort.metadata.endDate,seniorCount:cohort.seniors.length,days:cohort.metadata.days,
 observations:cohort.records.length,synthetic:true,timezone:'Asia/Kolkata',seed:cohort.metadata.seed,referenceSha256:cohort.metadata.reference?.source?.archiveSha256??cohort.seniors[0]?.dataProvenance?.referenceSha256};
const summary={datasetId:manifest.datasetId,seniors:manifest.seniorCount,from:manifest.startDate,to:manifest.endDate,days:manifest.days,observations:manifest.observations,expectedScores:manifest.days*manifest.seniorCount};
if(mode==='prepare'){
 const scores=[];
 for(let day=0;day<manifest.days;day++){
  const date=new Date(Date.parse(manifest.startDate)+day*86400000).toISOString().slice(0,10);
  for(const senior of cohort.seniors){const s=engine.scoreSenior(senior.id,date);scores.push({seniorId:senior.id,date,score:s.score,level:s.level,urgency:s.urgency,reasons:s.reasons??[],action:s.action,synthetic:true});}
 }
 await mkdir(resolve(root,'outputs'),{recursive:true});
 await writeFile(resolve(root,'outputs/history-import.json'),JSON.stringify({manifest,profiles:cohort.seniors,observations:cohort.records,scores}));
 console.log(JSON.stringify({...summary,mode:'prepared',scores:scores.length,unknownScores:scores.filter(s=>s.score===null).length}));
 process.exit(0);
}
const config=JSON.parse(await readFile(resolve(root,'config/supabase.json'),'utf8'));
if(new URL(config.url).hostname!=='gfymsmmgvecbzopypmfz.supabase.co')throw Error('This import is restricted to the Samarth Care project.');
const credentials=JSON.parse(await readFile(resolve(root,'outputs/owner-access.json'),'utf8'));
let accessToken;
async function call(path,{method='POST',body,headers={}}={}){
 const response=await fetch(config.url+path,{method,headers:{apikey:config.publishableKey,...(accessToken?{Authorization:`Bearer ${accessToken}`} :{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000),redirect:'error'});
 if(!response.ok){let value;try{value=await response.json();}catch{}throw Error(`History request failed (${response.status}): ${typeof value?.message==='string'?value.message.slice(0,220):'check server diagnostics'}`);}
 if(method==='HEAD'||response.status===204)return response;
 return response.json();
}
async function count(table,filter){const res=await call(`/rest/v1/${table}?select=id&${filter}`,{method:'HEAD',headers:{Prefer:'count=exact',Range:'0-0'}});return Number(res.headers.get('content-range')?.split('/')[1]);}
async function verify(){
 const result=await call(`/rest/v1/care_history_datasets?dataset_id=eq.${encodeURIComponent(manifest.datasetId)}&select=dataset_id,status,manifest`,{method:'GET'});
 if(result.length!==1||result[0].status!=='complete'||JSON.stringify(result[0].manifest)!==JSON.stringify(manifest)){
  // JSONB key order differs from JavaScript, so compare canonical field values.
  if(result.length!==1||result[0].status!=='complete'||Object.keys(manifest).some(k=>result[0].manifest?.[k]!==manifest[k]))throw Error('The versioned archive is absent, incomplete or has another manifest.');
 }
 const observations=await count('care_observations',`dataset_id=eq.${encodeURIComponent(manifest.datasetId)}`);
 const scores=await count('care_risk_history',`dataset_id=eq.${encodeURIComponent(manifest.datasetId)}`);
 if(observations!==manifest.observations||scores!==manifest.seniorCount*manifest.days)throw Error('Persisted history counts do not match the generated archive.');
 for(const senior of [cohort.seniors[0],cohort.seniors.at(-1)]){
  const range={seniorId:senior.id,from:manifest.startDate,to:manifest.endDate,asOfDate:manifest.endDate,groupBy:'day',datasetId:manifest.datasetId,limit:37};
  const ids=new Set();let cursor=null,first=true;
  do{
   const history=await call('/rest/v1/rpc/care_history',{body:{options:{...range,cursor}}});
   for(const entry of history.entries){if(ids.has(entry.id)||entry.date>manifest.endDate)throw Error('History pagination duplicates records or escapes its date boundary.');ids.add(entry.id);}
   if(first&&(history.buckets.length!==manifest.days||history.risk.length!==manifest.days))throw Error('The archive does not expose the full dated history.');
   first=false;cursor=history.nextCursor;
  }while(cursor);
  const expected=cohort.records.filter(r=>r.seniorId===senior.id).length;
  // Recorded additions are preserved too, so the combined timeline may be larger.
  if(ids.size<expected)throw Error('Timeline pagination lost archived observations.');
 }
 console.log(JSON.stringify({...summary,mode:'verified',observations,scores,pagination:'passed',synthetic:true}));
}
try{
 const login=await call('/auth/v1/token?grant_type=password',{body:{email:credentials.email,password:credentials.password}});accessToken=login.access_token;
 if(!accessToken)throw Error('The existing owner could not sign in.');
 if(mode==='import'){
  await call('/rest/v1/rpc/care_import_synthetic_history',{body:{batch:{manifest}}});
  for(let i=0;i<cohort.seniors.length;i+=500)await call('/rest/v1/rpc/care_import_synthetic_history',{body:{batch:{manifest,profiles:cohort.seniors.slice(i,i+500)}}});
  for(let i=0;i<cohort.records.length;i+=500){await call('/rest/v1/rpc/care_import_synthetic_history',{body:{batch:{manifest,observations:cohort.records.slice(i,i+500)}}});if(i%5000===0)console.log(JSON.stringify({stage:'observations',processed:Math.min(i+500,cohort.records.length),total:cohort.records.length}));}
  let chunk=[],processed=0;
  for(let day=0;day<manifest.days;day++){
   const date=new Date(Date.parse(manifest.startDate)+day*86400000).toISOString().slice(0,10);
   for(const senior of cohort.seniors){const s=engine.scoreSenior(senior.id,date);chunk.push({seniorId:senior.id,date,score:s.score,level:s.level,urgency:s.urgency,reasons:s.reasons??[],action:s.action,synthetic:true});
    if(chunk.length===500){await call('/rest/v1/rpc/care_import_synthetic_history',{body:{batch:{manifest,scores:chunk}}});processed+=chunk.length;chunk=[];if(processed%5000===0)console.log(JSON.stringify({stage:'risk-history',processed,total:manifest.days*manifest.seniorCount}));}
   }
  }
  if(chunk.length)await call('/rest/v1/rpc/care_import_synthetic_history',{body:{batch:{manifest,scores:chunk}}});
  await call('/rest/v1/rpc/care_import_synthetic_history',{body:{batch:{manifest,complete:true}}});
 }
 await verify();
}finally{
 if(accessToken)try{await call('/auth/v1/logout?scope=local',{body:{}});}catch{}
}
