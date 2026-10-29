import {validateAccountAction,AccountManagementError} from './account-management.mjs';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer'}});
const dictionary=value=>{try{return JSON.parse(value||'{}').default;}catch{return undefined;}};
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
const password=()=> 'Sc!'+[...crypto.getRandomValues(new Uint8Array(24))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function createAccountAdminHandler(env,{fetchImpl=fetch}={}) {
 return async request=>{
  try{
   if(request.method!=='POST'||!request.headers.get('content-type')?.includes('application/json'))return reply({error:'Use a JSON POST.'},405);
   const raw=await request.text();if(raw.length>24000)return reply({error:'Account request is too large.'},413);
   let input;try{input=JSON.parse(raw);}catch{return reply({error:'Invalid account request.'},400);}
   const action=input.action,payload=validateAccountAction(action,input.payload);
   const url=env.SUPABASE_URL,publicKey=dictionary(env.SUPABASE_PUBLISHABLE_KEYS)||env.SUPABASE_ANON_KEY,secret=dictionary(env.SUPABASE_SECRET_KEYS)||env.SUPABASE_SERVICE_ROLE_KEY;
   if(!url||!publicKey||!secret)return reply({error:'Account management is not configured.'},503);
   const token=request.headers.get('x-samarth-user-token')||'';
   const userHeaders={apikey:publicKey,Authorization:'Bearer '+token,'content-type':'application/json'};
   const userResponse=await fetchImpl(url+'/auth/v1/user',{headers:userHeaders,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!userResponse.ok)return reply({error:'Sign in as the operations administrator.'},401);
   const user=await userResponse.json();
   const access=await fetchImpl(url+'/rest/v1/rpc/care_account_directory',{method:'POST',headers:userHeaders,body:'{}',redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!access.ok)return reply({error:'Only the operations administrator can manage accounts.'},403);
   const directory=await access.json();
   if(!directory.some(a=>a.userId===user.id&&a.isAdmin===true&&a.status==='active'))return reply({error:'Administrator access is not active.'},403);
   const headers={apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'content-type':'application/json'};
   async function rpc(name,body){const r=await fetchImpl(url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw new AccountManagementError(data.code==='42501'?403:data.code==='23505'?409:400,data.code==='42501'?'This account is protected or your administrator access changed.':'The account change could not be completed. Refresh the directory and review the assignment.');return data;}
   if(payload.targetUserId){const target=directory.find(a=>a.userId===payload.targetUserId);if(!target&&action!=='delete')return reply({error:'Account not found.'},404);if(target?.isAdmin&&(action==='delete'||action==='password'||action==='update'&&(payload.action!=='update'||payload.role)))return reply({error:'The sole administrator is protected. Use your own account settings for password changes.'},403);}
   if(['create','assign','update','onboard'].includes(action))await rpc('care_admin_validate_identity',{actor_id:user.id,target_user_id:payload.targetUserId||directory.find(a=>a.email?.toLowerCase()===payload.email)?.userId||null,operation:action,details:Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='password'))});
   if(payload.role){const target=payload.targetUserId?directory.find(a=>a.userId===payload.targetUserId):directory.find(a=>a.email?.toLowerCase()===payload.email);if(target?.roles?.some(role=>role!==payload.role))return reply({error:'An account has one identity type. Create a separate login instead of changing its role.'},409);if(target?.roles?.includes('senior')&&payload.seniorIds?.[0]!==target.seniorIds?.[0])return reply({error:'A senior login must retain its own care record.'},409);if(payload.role==='senior'&&directory.some(a=>a.userId!==target?.userId&&a.roles?.includes('senior')&&a.seniorIds?.includes(payload.seniorIds?.[0])))return reply({error:'This senior already has a login. Manage the existing account.'},409);}
   let requestId=null;
   if(payload.idempotencyKey){requestId=payload.idempotencyKey;const reservation=await rpc('care_admin_request',{actor_id:user.id,request_id:requestId,operation:action,request_hash:await hash(Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='password')))});if(!reservation.fresh){if(reservation.status==='completed')return reply({...reservation.result,initialPassword:null,created:false,credentialsAlreadyShown:action==='create'||action==='password'});return reply({error:'This request already has an unconfirmed outcome. Refresh the directory before another action.'},409);}}
   let targetId=payload.targetUserId,initialPassword=null,created=false;
   if(action==='delete'){
    const reserved=await rpc('care_admin_delete_access',{actor_id:user.id,target_user_id:targetId,request_id:requestId});
    const deleted=await fetchImpl(url+'/auth/v1/admin/users/'+targetId,{method:'DELETE',headers,body:JSON.stringify({should_soft_delete:true}),redirect:'error',signal:AbortSignal.timeout(15000)});
    // A retry may find an Auth identity already soft-deleted. The completion RPC
    // verifies deleted_at before accepting that outcome; no missing user is assumed deleted.
    if(!deleted.ok&&deleted.status!==404)return reply({error:'Account access has been disabled. Login deletion is still pending; refresh the directory before retrying.'},503);
    const result=await rpc('care_admin_delete_complete',{actor_id:user.id,target_user_id:targetId,request_id:requestId});
    return reply({...result,recordsRetained:true,emailSent:false,previousEmail:reserved.email});
   }
   if(action==='create'||action==='onboard'||action==='assign'){
    const found=await rpc('care_admin_find_user',{actor_id:user.id,account_email:payload.email});
    if(action==='create'||action==='onboard'){
     if(found)return reply({error:'This email already has a login. Use Assign existing account; its password was not changed.'},409);
     initialPassword=payload.password||password();
     const createdUser=await fetchImpl(url+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email:payload.email,password:initialPassword,email_confirm:true,app_metadata:{samarth_admin_created:true},user_metadata:{display_name:payload.name}}),redirect:'error',signal:AbortSignal.timeout(15000)});
     if(!createdUser.ok)return reply({error:'The login could not be created. Refresh the directory before retrying.'},409);
     const result=await createdUser.json();targetId=result.id||result.user?.id;created=true;
    }else{if(!found)return reply({error:'No registered login uses this email. Create a login first.'},404);if(!found.confirmed)return reply({error:'This existing account must confirm its email before access is assigned.'},409);targetId=found.userId;}
   }
   if(action==='password'){
    initialPassword=payload.password||password();
    const updated=await fetchImpl(url+'/auth/v1/admin/users/'+targetId,{method:'PUT',headers,body:JSON.stringify({password:initialPassword}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!updated.ok)return reply({error:'The password reset has an unconfirmed outcome. Refresh the directory before retrying.'},503);
   }
   const operation=action==='update'?payload.action:action;
   const details=Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='password'));
   const result=action==='onboard'?await rpc('care_admin_onboard_senior',{actor_id:user.id,target_user_id:targetId,details,request_id:requestId}):await rpc('care_admin_apply',{actor_id:user.id,target_user_id:targetId,operation,details,request_id:requestId});
   return reply({...result,initialPassword:payload.password?null:initialPassword,passwordChosen:!!payload.password,created,emailConfirmationRequired:false,emailSent:false});
  }catch(error){return reply({error:error instanceof AccountManagementError?error.message:'The account request has an unconfirmed outcome. Refresh the directory before retrying.'},error instanceof AccountManagementError?error.status:503);}
 };
}
