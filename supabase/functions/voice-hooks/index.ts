import {createVoiceCallbackHandler} from '../../../lib/telephony-voice.mjs';
const runtime=globalThis as typeof globalThis&{Deno?:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):unknown}};
if(runtime.Deno){
 const env=runtime.Deno.env,dictionary=(raw?:string)=>{try{return JSON.parse(raw||'{}').default;}catch{return null;}};
 const secret=dictionary(env.get('SUPABASE_SECRET_KEYS'))||env.get('SUPABASE_SERVICE_ROLE_KEY')||'',url=env.get('SUPABASE_URL')||'';
 const rpc=async(name:string,body:unknown)=>{const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:`Bearer ${secret}`}:{ }),'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Call storage unavailable.');return response.json();};
 runtime.Deno.serve(createVoiceCallbackHandler({loadConfig:()=>rpc('care_voice_configuration',{}),getJob:(jobId:string)=>rpc('care_voice_job',{job_id:jobId}),advance:(job:{id:string;state:{step:number}},payload:unknown,signal?:unknown)=>rpc('care_voice_advance',{job_id:job.id,expected_revision:job.state.step,payload,signal:signal||null})}));
}
