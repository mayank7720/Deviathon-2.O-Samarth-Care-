import {verifyN8nEnvelope,signN8nEnvelope} from './n8n-integration.mjs';
import {startTrialVoiceCall,sha256,assertTrialCallWindow} from './telephony.mjs';
import {initialCallBot,finishInterruptedCall} from './call-bot.mjs';
import {assertCallingPolicy} from './calling-policy.mjs';
const check=(ok,status,message)=>{if(!ok)throw Object.assign(new Error(message),{status});};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function assertSavedVoiceCallWindow(job,env,now){
 if(env.SAMARTH_CALL_POLICY){
  let policy;try{policy=typeof env.SAMARTH_CALL_POLICY==='string'?JSON.parse(env.SAMARTH_CALL_POLICY):env.SAMARTH_CALL_POLICY;}catch{throw Object.assign(Error('The saved calling policy could not be read.'),{status:503});}
  assertCallingPolicy(policy,now,!!job.sourceRequestId);return;
 }
 const until=Date.parse(env.SAMARTH_CALL_DEMO_UNTIL||'');
 // The private RPC binds automatic jobs to the enabled senior/account policy.
 // A manual job or a client-supplied flag cannot opt into this exception.
 if(/^[a-f\d-]{36}$/iu.test(job.automationRunId||'')&&['senior','brief'].includes(job.automationPhase)&&Number.isFinite(until)&&until>now&&until-now<=2*3600000+60000)return;
 assertTrialCallWindow(now);
}
async function boundedBody(request){
 const contentLength=request.headers.get('content-length');
 check(!contentLength||/^\d+$/.test(contentLength)&&Number(contentLength)<=16384,413,'The call dispatch is too large.');
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>16384){await reader.cancel();throw Object.assign(new Error('The call dispatch is too large.'),{status:413});}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder().decode(bytes);
}
/** The web server authorizes the saved job; the protected worker owns carrier
 * submission and its result so browser clients cannot forge failed calls. */
export async function requestSavedVoiceDispatch(job,env,{fetchImpl=fetch}={}) {
 const target=new URL('/functions/v1/n8n-hooks/voice-dispatch',env.SUPABASE_URL);
 check(target.protocol==='https:'&&target.hostname.endsWith('.supabase.co')&&!target.username&&!target.password,503,'The protected call worker is not configured.');
 check(env.SUPABASE_LEGACY_ANON_KEY,503,'The protected call worker authentication is not configured.');
 const signed=await signN8nEnvelope({version:1,kind:'voice_checkin.request',jobId:job.id,language:job.language},env.SAMARTH_N8N_HMAC_SECRET);
 let response;try{response=await fetchImpl(target,{method:'POST',headers:{...signed.headers,apikey:env.SUPABASE_LEGACY_ANON_KEY,Authorization:'Bearer '+env.SUPABASE_LEGACY_ANON_KEY},body:signed.body,redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw Object.assign(Error('The call worker did not confirm its result. Refresh the saved call and inspect Twilio before requesting another.'),{status:503});}
 let data;try{data=await response.json();}catch{throw Object.assign(Error('The call worker returned no confirmed result. Refresh the call before retrying.'),{status:503});}
 check(response.ok,response.status>=400&&response.status<600?response.status:503,typeof data?.error==='string'?data.error:'The saved call could not be dispatched.');
 check(data?.accepted===true&&data.jobId===job.id&&/^CA[a-f0-9]{32}$/i.test(data.providerId||''),503,'The call worker did not confirm a provider identity. Inspect the saved call before retrying.');
 return data;
}
export function createN8nVoiceDispatchHandler({loadConfig,claimNonce,getJob,getContact,advance,startCall=startTrialVoiceCall,now=()=>Date.now()}){
 return async request=>{try{
  const raw=await boundedBody(request);
  const env=await loadConfig();
  const {envelope}=await verifyN8nEnvelope(request,raw,env,{expectedKind:'voice_checkin.request',claimNonce});
  check(Object.keys(envelope).every(k=>['version','kind','jobId','language'].includes(k)),400,'Call dispatch only accepts the saved request identity.');
  check(env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',503,'The credited calling provider is not connected.');
  const job=await getJob(envelope.jobId),contact=await getContact(envelope.jobId);
  check(job?.channel==='voice_bot'&&job.status==='queued'&&job.language===envelope.language&&Date.parse(job.expiresAt)>Date.now(),409,'The saved call is no longer available.');
  check(contact?.phone&&(!contact.role||contact.role===(job.recipientRole||'senior'))&&(!contact.seniorId||contact.seniorId===job.seniorId),403,'Current recipient consent or coordinator access is unavailable.');
  assertSavedVoiceCallWindow(job,env,now());
  const origin=new URL(env.SAMARTH_PUBLIC_URL);check(origin.protocol==='https:'&&!origin.username&&!origin.password,503,'The public callback origin is invalid.');
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),base=origin.origin+'/api/telephony/twilio';
  const submitted={...job,status:'submitting',voiceState:initialCallBot(job.language,{spokenChoices:env.SAMARTH_CALL_BOT_SPOKEN_CHOICES==='true',recipientRole:job.recipientRole||'senior',notice:contact.voiceNotice}),callbackOrigin:origin.origin,callbackTokenHash:await sha256(token),updatedAt:new Date().toISOString()};
  check(await advance(job,submitted)!==false,409,'This call is already being submitted.');
  let result;
  try{result=await startCall({...submitted,phone:contact.phone,callbackUrl:`${base}/checkin/${job.id}/${token}?phase=prompt&step=0`,statusCallbackUrl:`${base}/status/${job.id}/${token}`},env);}
  catch(error){
   const current=await getJob(job.id);
   if(current?.status==='submitting'&&!current.providerId){
    const known=error.callNotPlaced===true;
    const lastError=known?'The trial call was not placed. Check the trial account, caller and verified recipient before creating another request.':'The call submission outcome is uncertain. Inspect Twilio before requesting another call.';
    check(await advance(current,{...current,status:known?'failed':'submission_unknown',lastError,...(known?{voiceState:finishInterruptedCall(current.voiceState)}:{}),updatedAt:new Date().toISOString()})!==false,503,'The call result is awaiting storage confirmation. Refresh and inspect the provider before retrying.');
   }
   // A callback may have completed the call while the submission timed out.
   if(current?.providerId&&current.status!=='submitting')return reply({accepted:true,jobId:job.id,status:current.status,providerId:current.providerId},202);
   throw error;
  }
  // A signed provider callback can arrive before the call-creation response.
  // Preserve that newer evidence and retry only the storage CAS, never the call.
  let saved=false;
  for(let attempt=0;attempt<3&&!saved;attempt++){
   const current=await getJob(job.id);
   check(current&&(!current.providerId||current.providerId===result.providerId),409,'The saved call has conflicting provider evidence.');
   const next=current.status==='submitting'?{...current,...result}:{...current,providerId:result.providerId};
   saved=await advance(current,{...next,updatedAt:new Date().toISOString()})!==false;
  }
  check(saved,503,'Provider acceptance is awaiting storage confirmation. Inspect the call before retrying.');
  return reply({accepted:true,jobId:job.id,status:'accepted',providerId:result.providerId},202);
 }catch(error){return reply({error:error.status?error.message:'The saved call could not be dispatched. Inspect the provider before retrying.'},error.status||503);}};
}
