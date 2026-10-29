import {createN8nHooksHandler} from '../../../lib/n8n-hooks.mjs';
import {createN8nVoiceDispatchHandler} from '../../../lib/voice-dispatch.mjs';
const runtime=globalThis as typeof globalThis&{Deno?:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):unknown}};
if(runtime.Deno){
 const env=runtime.Deno.env,dictionary=(raw?:string)=>{try{return JSON.parse(raw||'{}').default;}catch{return null;}};
 const secret=dictionary(env.get('SUPABASE_SECRET_KEYS'))||env.get('SUPABASE_SERVICE_ROLE_KEY')||'',url=env.get('SUPABASE_URL')||'';
 const rpc=async(name:string,body:unknown)=>{const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:`Bearer ${secret}`}:{ }),'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Integration storage unavailable.');return response.json();};
 const claimNonce=({nonceHash,jobId,kind,expiresAt}:{nonceHash:string;jobId:string;kind:string;expiresAt:number})=>rpc('care_n8n_claim_nonce',{nonce_hash:nonceHash,job_id:jobId,kind,expires_at:expiresAt});
 const reports=createN8nHooksHandler({loadConfig:()=>rpc('care_n8n_configuration',{}),claimNonce,getJob:(jobId:string)=>rpc('care_n8n_job',{job_id:jobId}),claimReport:(jobId:string,proof:{factsHash:string;language:string})=>rpc('care_n8n_claim_report',{job_id:jobId,facts_hash:proof.factsHash,report_language:proof.language}),completeReport:(jobId:string,report:unknown)=>rpc('care_n8n_complete',{job_id:jobId,report}),failReport:(jobId:string,failure:{factsHash:string;failureCode:string})=>rpc('care_n8n_fail',{job_id:jobId,facts_hash:failure.factsHash,failure_code:failure.failureCode})});
 const voice=createN8nVoiceDispatchHandler({loadConfig:()=>rpc('care_voice_dispatch_configuration',{}),claimNonce,getJob:(jobId:string)=>rpc('care_voice_job',{job_id:jobId}),getContact:(jobId:string)=>rpc('care_voice_contact',{job_id:jobId}),advance:(job:{id:string;state:{step:number}},payload:unknown)=>rpc('care_voice_advance',{job_id:job.id,expected_revision:job.state.step,payload,signal:null})});
 runtime.Deno.serve((request:Request)=>new URL(request.url).pathname.endsWith('/voice-dispatch')?voice(request):reports(request));
}
