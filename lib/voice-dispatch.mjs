import {verifyN8nEnvelope} from './n8n-integration.mjs';
import {startTrialVoiceCall,sha256} from './telephony.mjs';
const check=(ok,status,message)=>{if(!ok)throw Object.assign(new Error(message),{status});};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
async function boundedBody(request){
 const contentLength=request.headers.get('content-length');
 check(!contentLength||/^\d+$/.test(contentLength)&&Number(contentLength)<=16384,413,'The call dispatch is too large.');
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>16384){await reader.cancel();throw Object.assign(new Error('The call dispatch is too large.'),{status:413});}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder().decode(bytes);
}
export function createN8nVoiceDispatchHandler({loadConfig,claimNonce,getJob,getContact,advance,startCall=startTrialVoiceCall}){
 return async request=>{try{
  const raw=await boundedBody(request);
  const env=await loadConfig();
  const {envelope}=await verifyN8nEnvelope(request,raw,env,{expectedKind:'voice_checkin.request',claimNonce});
  check(Object.keys(envelope).every(k=>['version','kind','jobId','language'].includes(k)),400,'Call dispatch only accepts the saved request identity.');
  check(env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',503,'The credited calling provider is not connected.');
  const job=await getJob(envelope.jobId),contact=await getContact(envelope.jobId);
  check(job?.channel==='voice_bot'&&job.status==='queued'&&job.language===envelope.language&&Date.parse(job.expiresAt)>Date.now(),409,'The saved call is no longer available.');
  check(contact?.phone,403,'Current recipient consent or coordinator access is unavailable.');
  const origin=new URL(env.SAMARTH_PUBLIC_URL);check(origin.protocol==='https:'&&!origin.username&&!origin.password,503,'The public callback origin is invalid.');
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),base=origin.origin+'/api/telephony/twilio';
  const submitted={...job,status:'submitting',voiceState:{language:job.language,step:0,answers:{}},callbackOrigin:origin.origin,callbackTokenHash:await sha256(token),updatedAt:new Date().toISOString()};
  check(await advance(job,submitted)!==false,409,'This call is already being submitted.');
  const result=await startCall({...submitted,phone:contact.phone,callbackUrl:`${base}/checkin/${job.id}/${token}?phase=prompt&step=0`,statusCallbackUrl:`${base}/status/${job.id}/${token}`},env);
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
