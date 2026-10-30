import {createN8nVoiceDispatchHandler} from './voice-dispatch.mjs';
import {signN8nEnvelope} from './n8n-integration.mjs';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
/** Cron supplies a private Vault key in addition to the Edge JWT check.
 * Tick persists one leased job before dispatch; retries never re-submit an
 * uncertain carrier request. No messages or patient content leave this response. */
export function createCallAutomationWorker({loadConfig,tick,claimNonce,getJob,getContact,advance,noteFailure,startCall,now=()=>Date.now()}){
 return async request=>{
  try{
   if(request.method!=='POST')return reply({error:'Use the protected automation scheduler.'},405);
   const env=await loadConfig(),key=request.headers.get('x-samarth-automation-key')||'',expected=env.SAMARTH_N8N_HMAC_SECRET||'';
   if(expected.length<32||key.length!==expected.length)return reply({error:'Invalid scheduler credential.'},401);
   let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=key.charCodeAt(i)^expected.charCodeAt(i);
   if(mismatch)return reply({error:'Invalid scheduler credential.'},401);
   if((request.headers.get('content-length')&&Number(request.headers.get('content-length'))>100)||await request.text()!=='{}')return reply({error:'The scheduler accepts no recipient or time overrides.'},400);
   const result=await tick();
   if(!result?.jobId)return reply({ok:true,dispatched:false,reason:result?.reason||'no_due_calls'});
   if(!/^[a-f\d-]{36}$/iu.test(result.jobId)||!['en','hi'].includes(result.language))throw Error('Invalid saved action');
   const voice=createN8nVoiceDispatchHandler({loadConfig:async()=>env,claimNonce,getJob,getContact,advance,...(startCall?{startCall}:{}),now});
   const signed=await signN8nEnvelope({version:1,kind:'voice_checkin.request',jobId:result.jobId,language:result.language},env.SAMARTH_N8N_HMAC_SECRET);
   const response=await voice(new Request('https://scheduler.invalid/voice-dispatch',{method:'POST',headers:signed.headers,body:signed.body}));
   if(!response.ok){await noteFailure(result.jobId,'worker_unavailable');return reply({ok:false,dispatched:false,reason:'worker_unavailable'},503);}
   return reply({ok:true,dispatched:true});
  }catch{return reply({error:'The automatic calling worker could not confirm its result. No automatic redial is allowed.'},503);}
 };
}
