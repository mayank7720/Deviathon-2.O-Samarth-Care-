import { createReportFacts,providerReportFacts,reportPlanSchema } from './grounded-reports.mjs';

const encoder=new TextEncoder();
const check=(ok,status,message)=>{if(!ok){const error=new Error(message);error.status=status;throw error;}};
const hex=value=>[...new Uint8Array(value)].map(n=>n.toString(16).padStart(2,'0')).join('');
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(value);
const kinds=new Set(['weekly_report.request','weekly_report.completed','weekly_report.failed','voice_checkin.request','voice_checkin.completed','care_event.request','care_event.completed']);
export function canonicalJson(value) {
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'){check(Number.isFinite(value),400,'Non-finite integration values are not supported.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  check(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,400,'Only plain JSON integration values are supported.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
}
export async function integrationHash(value){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(canonicalJson(value))));}
function secretValue(secret){check(typeof secret==='string'&&secret.length>=32&&secret.length<=256,503,'The n8n signing credential is not configured.');return secret;}
export async function signN8nEnvelope(envelope,secret,{now=Date.now(),nonce=crypto.randomUUID()}={}) {
  secretValue(secret);check(safeId(nonce),400,'Use an opaque integration nonce.');
  const body=canonicalJson(envelope),timestamp=String(Math.floor(now/1000));
  check(encoder.encode(body).length<=131072,413,'The n8n request is too large.');
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=hex(await crypto.subtle.sign('HMAC',key,encoder.encode(`${timestamp}\n${nonce}\n${body}`)));
  return {body,headers:{'content-type':'application/json','x-samarth-timestamp':timestamp,'x-samarth-nonce':nonce,'x-samarth-signature':signature}};
}
/** claimNonce must insert once in durable storage; an in-memory set is insufficient. */
export async function verifyN8nEnvelope(request,raw,env={}, {now=Date.now(),expectedKind,claimNonce}={}) {
  const secret=secretValue(env.SAMARTH_N8N_HMAC_SECRET);
  check(request.method==='POST',405,'Use POST for integration callbacks.');
  check(request.headers.get('content-type')?.includes('application/json'),415,'Use application/json.');
  const timestamp=request.headers.get('x-samarth-timestamp')||'',nonce=request.headers.get('x-samarth-nonce')||'',signature=request.headers.get('x-samarth-signature')||'';
  check(/^\d{10}$/.test(timestamp)&&safeId(nonce)&&/^[a-f0-9]{64}$/i.test(signature),401,'Invalid n8n signature.');
  check(Number.isFinite(now)&&Math.abs(now-Number(timestamp)*1000)<=300000,401,'The n8n callback has expired.');
  check(typeof raw==='string'&&encoder.encode(raw).length<=131072,413,'The n8n callback is too large.');
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signatureBytes=Uint8Array.from(signature.match(/../g),part=>parseInt(part,16));
  check(await crypto.subtle.verify('HMAC',key,signatureBytes,encoder.encode(`${timestamp}\n${nonce}\n${raw}`)),401,'Invalid n8n signature.');
  let envelope;try{envelope=JSON.parse(raw);}catch{check(false,400,'The n8n callback contains invalid JSON.');}
  check(envelope&&typeof envelope==='object'&&!Array.isArray(envelope)&&envelope.version===1&&safeId(envelope.jobId)&&kinds.has(envelope.kind),400,'Invalid n8n job envelope.');
  check(!expectedKind||(Array.isArray(expectedKind)?expectedKind.includes(envelope.kind):envelope.kind===expectedKind),400,'Unexpected n8n job kind.');
  check(typeof claimNonce==='function',503,'Durable integration replay protection is not configured.');
  const nonceHash=await integrationHash({nonce});
  check(await claimNonce({nonceHash,jobId:envelope.jobId,kind:envelope.kind,expiresAt:now+600000}),409,'This n8n request has already been received.');
  return {envelope,nonceHash,timestamp:Number(timestamp)*1000};
}
export async function createN8nReportRequest({jobId=crypto.randomUUID(),senior,records,asOfDate,language='en',dataKind}) {
  check(safeId(jobId),400,'Use an opaque report job ID.');
  const localFacts=createReportFacts(senior,records,asOfDate,{dataKind}),facts=providerReportFacts(localFacts),factsHash=await integrationHash(facts);
  return {envelope:{version:1,kind:'weekly_report.request',jobId,language,factsHash,facts,schema:reportPlanSchema(localFacts,language)},localFacts,factsHash};
}
export function n8nConfiguration(env={}) {
  check(env.SAMARTH_N8N_ENABLED==='true',503,'The n8n integration is not enabled.');
  let url;try{url=new URL(env.SAMARTH_N8N_REPORT_WEBHOOK_URL);}catch{check(false,503,'The n8n report webhook is not configured.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  check(!url.username&&!url.password&&!url.search&&!url.hash,503,'The n8n endpoint must not contain credentials or query parameters.');
  check(url.protocol==='https:'||(local&&env.SAMARTH_N8N_ALLOW_LOCAL==='true'&&url.protocol==='http:'),503,'n8n requires HTTPS outside explicitly enabled local development.');
  check(url.pathname.startsWith('/webhook/')||env.SAMARTH_N8N_ALLOW_TEST_WEBHOOK==='true'&&url.pathname.startsWith('/webhook-test/'),503,'Use a published n8n webhook URL.');
  check(url.hostname.endsWith('.n8n.cloud')||url.hostname===env.SAMARTH_N8N_ALLOWED_HOST||(local&&env.SAMARTH_N8N_ALLOW_LOCAL==='true'),503,'The n8n host is not allowlisted.');
  secretValue(env.SAMARTH_N8N_HMAC_SECRET);
  return {url:url.href,secret:env.SAMARTH_N8N_HMAC_SECRET};
}
export async function dispatchN8nReport(envelope,env={}, {fetchImpl=fetch,now,nonce}={}) {
  const config=n8nConfiguration(env);
  check(envelope?.kind==='weekly_report.request',400,'Use a report request envelope.');
  const signed=await signN8nEnvelope(envelope,config.secret,{now,nonce});
  let response;
  try{response=await fetchImpl(config.url,{method:'POST',headers:signed.headers,body:signed.body,redirect:'manual',signal:AbortSignal.timeout(90000)});}catch{throw Object.assign(new Error('The saved report job has an unconfirmed n8n submission. Check its status and execution before creating another request.'),{status:503});}
  check(response.ok,503,'n8n rejected the report request. Review its execution before retrying.');
  const raw=await response.text();check(raw.length<=16000,502,'n8n returned an oversized acknowledgement.');
  let acknowledgement;try{acknowledgement=JSON.parse(raw);}catch{check(false,502,'n8n returned an invalid acknowledgement.');}
  check(acknowledgement?.jobId===envelope.jobId&&acknowledgement?.accepted===true&&acknowledgement?.status==='processing'&&acknowledgement?.generationCompleted===false,502,'n8n did not acknowledge a processing report job. Inspect its execution before submitting another request.');
  return {accepted:true,jobId:envelope.jobId,status:'processing',generationCompleted:false,providerExecution:typeof acknowledgement.executionId==='string'?acknowledgement.executionId.slice(0,100):null};
}
