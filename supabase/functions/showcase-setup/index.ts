import {createServiceJobStore} from '../../../lib/service-job-store.mjs';
const runtime=globalThis as typeof globalThis&{Deno?:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):unknown}};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
if(runtime.Deno){
  const env=Object.fromEntries(['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEYS','SUPABASE_PUBLISHABLE_KEYS','SAMARTH_SHOWCASE_OWNER_EMAIL'].map(k=>[k,runtime.Deno!.env.get(k)]));
  const dictionary=(raw?:string)=>{try{return JSON.parse(raw||'{}').default;}catch{return null;}};
  runtime.Deno.serve(async request=>{
    try{
      if(request.method!=='POST'||(await request.text()).trim()!=='{}')return response({error:'Use POST with an empty object.'},400);
      const db=createServiceJobStore(env);await db.validateJobSecret(request.headers.get('x-samarth-job-secret'));
      const ownerEmail=(env.SAMARTH_SHOWCASE_OWNER_EMAIL||'').trim().toLowerCase();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail))return response({error:'Owner setup is not configured.'},503);
      const url=env.SUPABASE_URL!,secret=dictionary(env.SUPABASE_SECRET_KEYS)||env.SUPABASE_SERVICE_ROLE_KEY!,publicKey=dictionary(env.SUPABASE_PUBLISHABLE_KEYS)||env.SUPABASE_ANON_KEY!;
      const privileged={apikey:secret,...(secret.startsWith('eyJ')?{Authorization:`Bearer ${secret}`}:{})};
      const password='Ac!3'+Array.from(crypto.getRandomValues(new Uint8Array(28)),n=>n.toString(16).padStart(2,'0')).join('');
      const created=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers:{...privileged,'content-type':'application/json'},body:JSON.stringify({email:ownerEmail,password,email_confirm:true,user_metadata:{display_name:'Samarth Care Owner',provisioning:'User-authorized administrator setup'}})});
      if(!created.ok)return response({error:'Owner creation was not completed. Existing accounts and passwords are never changed by this endpoint.'},409);
      const owner=await created.json(),ownerId=owner.id||owner.user?.id;
      const saved=await fetch(url+'/rest/v1/rpc/care_save_owner_access',{method:'POST',headers:{...privileged,'content-type':'application/json'},body:JSON.stringify({owner_id:ownerId,password})});
      if(!saved.ok)throw new Error('Private credential storage failed.');
      const login=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:publicKey,'content-type':'application/json'},body:JSON.stringify({email:ownerEmail,password})});
      if(!login.ok)throw new Error('Owner sign-in failed.');
      const tokens=await login.json();
      const boot=await fetch(url+'/rest/v1/rpc/care_bootstrap_owner',{method:'POST',headers:{apikey:publicKey,Authorization:`Bearer ${tokens.access_token}`,'content-type':'application/json'},body:'{}'});
      if(!boot.ok||await boot.json()!==true)throw new Error('Owner membership setup failed.');
      return response({ok:true,ownerProvisioned:true,workspaceInitialized:true,passwordStoredPrivately:true});
    }catch{return response({error:'Owner setup could not finish. No credentials are returned by this endpoint.'},500);}
  });
}
