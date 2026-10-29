/** Privileged storage for the verified scheduler only. Never import into user APIs. */
export class ServiceJobError extends Error {
  constructor(status,message){super(message);this.status=status;this.name='ServiceJobError';}
}
const check=(value,status,message)=>{if(!value)throw new ServiceJobError(status,message);};
const WORKFLOW_OPERATIONS=new Set(['members_get','runtime_get','job_get','job_put','consents_get','consents_seed','consent_put','scores_get','scores_put','score_get','alert_seen_put','delivery_put','deliveries_get','delivery_get','delivery_claim','delivery_update','push_get','push_delete']);
const EVENT_INSERT='insert into care_events(id,owner,kind,senior_id,payload,created_at)values(?,?,?,?,?,?)';
const normalize=sql=>String(sql).replace(/\s+/g,' ').replace(/\s*([(),=])\s*/g,'$1').trim().toLowerCase();
function dictionaryDefault(raw){try{const value=typeof raw==='string'?JSON.parse(raw):raw;return typeof value?.default==='string'?value.default.trim():null;}catch{return null;}}
function configuration(env) {
  const url=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  let parsed;try{parsed=new URL(url);}catch{throw new ServiceJobError(503,'The background database is not configured.');}
  check(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.pathname==='/',503,'The background database must use a secure project origin.');
  const anonKey=dictionaryDefault(env.SUPABASE_PUBLISHABLE_KEYS)||String(env.SUPABASE_ANON_KEY||'').trim();
  const serviceKey=dictionaryDefault(env.SUPABASE_SECRET_KEYS)||String(env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
  check(serviceKey,503,'The background database credentials are not configured.');
  // Modern secret keys are opaque, not JWTs. The API gateway authenticates them
  // on apikey; forwarding them as a Bearer token would fail JWT validation.
  if(/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(serviceKey))return {url:parsed.origin,headers:{apikey:serviceKey}};
  check(anonKey&&anonKey!==serviceKey,503,'The background database credentials are not configured.');
  let role;try{const encoded=serviceKey.split('.')[1].replaceAll('-','+').replaceAll('_','/');role=JSON.parse(atob(encoded+'='.repeat((4-encoded.length%4)%4))).role;}catch{throw new ServiceJobError(503,'A server secret key or service-role JWT is required for the background processor.');}
  check(role==='service_role',503,'A service-role JWT is required for the background processor.');
  return {url:parsed.origin,headers:{apikey:anonKey,Authorization:`Bearer ${serviceKey}`}};
}

/** Caller must validate the private job secret before running any care operation. */
export function createServiceJobStore(env={}, {fetchImpl=fetch}={}) {
  const config=configuration(env);
  let authorized=false;
  async function rpc(name,body,{validation=false}={}) {
    check(validation||authorized,403,'The background processor has not been authorized.');
    let response;
    try{response=await fetchImpl(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{...config.headers,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});}
    catch{throw new ServiceJobError(503,'The background database is temporarily unavailable.');}
    let data;try{data=await response.json();}catch{throw new ServiceJobError(502,'The background database returned an invalid response.');}
    check(response.ok,response.status===401||response.status===403?403:503,'The background database could not complete the request.');
    return data;
  }
  const db={
    backend:'supabase-service-job',
    async validateJobSecret(secret) {
      authorized=false;
      check(typeof secret==='string'&&secret.length>=32&&secret.length<=256,401,'The background job credential is invalid.');
      const result=await rpc('care_validate_job_secret',{secret},{validation:true});
      authorized=result===true;
      check(authorized,401,'The background job credential is invalid.');return true;
    },
    notificationRouting(action,payload={}){return rpc('care_notification_routing',{action,payload});},
    jobConfiguration(){return rpc('care_job_configuration',{});},
    recordedProfiles(){return rpc('care_recorded_profiles',{});},
    historyDirty(options={}){return rpc('care_history_dirty',{options});},
    historyScores(options){return rpc('care_history_scores_put',{options});},
    workflow(operation,payload={}) {check(WORKFLOW_OPERATIONS.has(operation),403,'This operation is not available to the background processor.');return rpc('care_workflow',{operation,payload});},
    scanEvents({owner,seniorIds=null,kinds=null,limit=5000,sinceRecordDate=null,beforeCreatedAt=null,beforeSequence=null,ascending=true}={}) {
      return rpc('care_events_scan',{options:{owner,seniorIds,kinds,limit:Math.min(5000,Math.max(1,Number(limit)||5000)),sinceRecordDate,beforeCreatedAt,beforeSequence,ascending}});
    },
    prepare(sql) {
      check(normalize(sql)===EVENT_INSERT,403,'The background processor only accepts named storage operations.');
      const wrap=(args=[])=>({op:'event_insert',args,bind:(...values)=>wrap(values),async all(){return (await db.batch([this]))[0];},async run(){return this.all();},async first(){return (await this.all()).results?.[0]||null;}});
      return wrap();
    },
    async batch(statements) {
      check(Array.isArray(statements)&&statements.length>0&&statements.length<=100&&statements.every(item=>item.op==='event_insert'&&Array.isArray(item.args)&&item.args.length===6),403,'Invalid background storage batch.');
      return rpc('care_store_batch',{commands:statements.map(({op,args})=>({op,args}))});
    },
  };
  return db;
}
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function limitedBody(request) {
  check(!request.headers.get('content-length')||Number(request.headers.get('content-length'))<=1024,413,'The background job body is too large.');
  if(!request.body)return '';
  const reader=request.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1024){await reader.cancel();throw new ServiceJobError(413,'The background job body is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}

export function createDailyCareHandler(env,runDaily,{fetchImpl=fetch}={}) {
  return async request=>{
    try {
      check(request.method==='POST',405,'Use POST for background processing.');
      check(!new URL(request.url).search,400,'Background processing does not accept query parameters.');
      const secret=request.headers.get('x-samarth-job-secret');
      check(typeof secret==='string'&&secret.length>=32&&secret.length<=256,401,'The background job credential is invalid.');
      const raw=await limitedBody(request);
      if(raw.trim()) {let body;try{body=JSON.parse(raw);}catch{throw new ServiceJobError(400,'Send an empty JSON object.');}check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0,400,'Background processing does not accept job parameters.');}
      const db=createServiceJobStore(env,{fetchImpl});
      await db.validateJobSecret(secret);
      const configured=await db.jobConfiguration();
      const jobEnv={...env};
      for(const key of ['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','SAMARTH_DATA_MODE','SAMARTH_COHORT_END'])if(typeof configured?.[key]==='string'&&configured[key])jobEnv[key]=configured[key];
      const result=await runDaily(db,jobEnv);
      const job=result?.job?{id:result.job.id,status:result.job.status,date:result.job.date}:undefined;
      const delivery=result?.delivery?Object.fromEntries(['delivered','failed','blocked'].map(key=>[key,Number(result.delivery[key])||0])):undefined;
      return reply({ok:true,...(job?{job}:{}),...(delivery?{delivery}:{}),...(result?.deliveriesQueued!=null?{deliveriesQueued:Number(result.deliveriesQueued)||0}:{}),...(result?.skipped?{skipped:'No active workspace coordinator.'}:{})});
    }catch(error){return reply({ok:false,error:error instanceof ServiceJobError?error.message:'Daily processing failed. A later run can retry.'},error instanceof ServiceJobError?error.status:500);}
  };
}
