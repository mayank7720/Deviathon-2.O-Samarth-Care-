// Fixed synthetic showcase provisioning. No service key leaves this function.
declare const Deno: {env:{get(key:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const accountEmails=['coordinator@samarth.test','family@samarth.test','senior1@samarth.test','senior2@samarth.test'];
const dictionary=(value?:string)=>{try{return JSON.parse(value||'{}').default;}catch{return undefined;}};
Deno.serve(async request=>{
 try {
  if(request.method!=='POST'||request.headers.get('content-type')!=='application/json')return reply({error:'Use a JSON POST.'},405);
  const raw=await request.text();if(raw.length>10000)return reply({error:'Request too large.'},413);
  const body=JSON.parse(raw);
  if(body?.confirmShowcase!==true||!Array.isArray(body.accounts)||body.accounts.length!==4)return reply({error:'Confirm the fixed four-account showcase setup.'},400);
  const url=Deno.env.get('SUPABASE_URL')!,publicKey=dictionary(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))||Deno.env.get('SUPABASE_ANON_KEY')!;
  const secret=dictionary(Deno.env.get('SUPABASE_SECRET_KEYS'))||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // The gateway validates the project JWT; independently verify the actor's
  // modern user token rather than treating the gateway credential as a user.
  const actorToken=request.headers.get('x-samarth-user-token')||'';
  const authorization='Bearer '+actorToken;
  const verified=await fetch(url+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:authorization}});
  if(!verified.ok)return reply({error:'Sign in as the operations administrator.'},401);
  const user=await verified.json();
  const userHeaders={apikey:publicKey,Authorization:authorization,'content-type':'application/json'};
  const access=await fetch(url+'/rest/v1/rpc/care_account_directory',{method:'POST',headers:userHeaders,body:'{}'});
  if(!access.ok)return reply({error:'Only the operations administrator can provision these accounts.'},403);
  const directory=await access.json();if(!directory.some((a:{userId:string;roles:string[]})=>a.userId===user.id&&a.roles.includes('operations')))return reply({error:'Administrator identity is not active.'},403);
  for(const email of accountEmails){const item=body.accounts.find((a:{email:string})=>a.email===email);if(!item||typeof item.password!=='string'||item.password.length<16||item.password.length>100)return reply({error:'Supply one strong password for each fixed showcase identity.'},400);}
  const serviceHeaders={apikey:secret,...(secret.startsWith('eyJ')?{Authorization:`Bearer ${secret}`}:{}) ,'content-type':'application/json'};
  const listing=await fetch(url+'/auth/v1/admin/users?page=1&per_page=50',{headers:serviceHeaders});if(!listing.ok)throw Error('list');
  const users=(await listing.json()).users||[];
  const result=[];
  for(const email of accountEmails){
   const existing=users.find((u:{email:string})=>u.email===email);
   if(existing){if(existing.app_metadata?.samarth_showcase!=='v1')return reply({error:'An existing identity needs administrator review; no password was changed.'},409);result.push({email,created:false});continue;}
   const password=body.accounts.find((a:{email:string})=>a.email===email).password;
   const response=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email,password,email_confirm:true,app_metadata:{samarth_showcase:'v1'},user_metadata:{display_name:email.split('@')[0]}})});
   if(!response.ok)throw Error('create');result.push({email,created:true});
  }
  const finish=await fetch(url+'/rest/v1/rpc/care_finish_showcase_accounts',{method:'POST',headers:serviceHeaders,body:'{}'});
  if(!finish.ok)throw Error('finish');
  return reply({ok:true,accounts:result,familyLinks:2,phoneNumbersAssigned:false});
 }catch{return reply({error:'Account setup could not finish. Existing passwords are never reset by this action.'},500);}
});
