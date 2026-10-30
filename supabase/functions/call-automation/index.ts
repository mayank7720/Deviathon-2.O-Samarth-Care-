import {createCallAutomationWorker} from '../../../lib/call-automation-worker.mjs';
const runtime=globalThis as typeof globalThis&{Deno?:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):unknown}};
if(runtime.Deno){
 const env=runtime.Deno.env,dictionary=(raw?:string)=>{try{return JSON.parse(raw||'{}').default;}catch{return null;}};
 const secret=dictionary(env.get('SUPABASE_SECRET_KEYS'))||env.get('SUPABASE_SERVICE_ROLE_KEY')||'',url=env.get('SUPABASE_URL')||'';
 const rpc=async(name:string,body:unknown)=>{
  const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Automatic calling storage unavailable.');return response.json();
 };
 runtime.Deno.serve(createCallAutomationWorker({
  loadConfig:()=>rpc('care_voice_dispatch_configuration',{}),tick:()=>rpc('care_call_automation_worker',{action:'tick',payload:{}}),
  claimNonce:({nonceHash,jobId,kind,expiresAt}:{nonceHash:string;jobId:string;kind:string;expiresAt:number})=>rpc('care_n8n_claim_nonce',{nonce_hash:nonceHash,job_id:jobId,kind,expires_at:expiresAt}),
  getJob:(id:string)=>rpc('care_voice_job',{job_id:id}),getContact:(id:string)=>rpc('care_voice_contact',{job_id:id}),
  advance:(job:{id:string;state:{step:number}},payload:unknown)=>rpc('care_voice_advance',{job_id:job.id,expected_revision:job.state.step,payload,signal:null}),
  noteFailure:(id:string,reason:string)=>rpc('care_call_automation_worker',{action:'failure',payload:{jobId:id,reason}}),
 }));
}
