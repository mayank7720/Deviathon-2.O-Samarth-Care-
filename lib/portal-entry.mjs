const roles=new Set(['family','senior','coordinator','operations']);

/** URL hints choose a form only. The checked invitation transaction grants access. */
export function invitationDetails(value='') {
 const text=typeof value==='string'?value.trim():'';
 if(!text)return {token:'',role:'',present:false,valid:false};
 if(/^[a-f0-9]{64}$/i.test(text))return {token:text.toLowerCase(),role:'',present:true,valid:true};
 try {
  const url=new URL(text,'https://care.invalid/'),query=url.searchParams,hash=new URLSearchParams(url.hash.slice(1));
  const token=query.get('invite')||query.get('token')||hash.get('invite')||hash.get('token')||'';
  const hintedRole=hash.get('role')||query.get('role')||'';
  return {token:/^[a-f0-9]{64}$/i.test(token)?token.toLowerCase():'',role:roles.has(hintedRole)?hintedRole:'',present:query.has('invite')||query.has('token')||hash.has('invite')||hash.has('token'),valid:/^[a-f0-9]{64}$/i.test(token)};
 } catch {return {token:'',role:'',present:true,valid:false};}
}

export function canEnterPortal(state) {
 return state?.authenticated===true&&state.accountStatus?.enabled!==false&&state.accountStatus?.reauthenticationRequired!==true&&
  (state.authorized===true||state.memberships?.some(member=>member.status===undefined||member.status==='active'))&&!!state.session;
}

export class CareRequestError extends Error {
 constructor(message,{status=0,code='',availableRoles=[],retryAfter}={}){
  super(message);this.name='CareRequestError';this.status=status;this.code=code;
  this.availableRoles=Array.isArray(availableRoles)?availableRoles.filter(role=>roles.has(role)):[];
  if(Number.isFinite(retryAfter))this.retryAfter=retryAfter;
 }
}

/** Keep gateway failures readable and never expose a raw HTML/provider response. */
export async function careRequest(path,method='GET',body,{fetchImpl=fetch,timeoutMs=path.startsWith('/auth')?45000:120000}={}) {
 let response;
 try {
  response=await fetchImpl(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',headers:body!==undefined?{'content-type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
 }catch(error){
  throw new CareRequestError(error?.name==='TimeoutError'||error?.name==='AbortError'?'This request is taking too long. Check your connection and try again.':'Unable to reach Samarth Care. Check your connection and try again.',{code:'CONNECTION_UNAVAILABLE'});
 }
 let result;try{result=await response.json();}catch{throw new CareRequestError(response.status>=500?'The care service is temporarily unavailable. Please try again.':'The care service returned an incomplete response. Please try again.',{status:response.status,code:'INVALID_RESPONSE'});}
 if(!response.ok){
  const serverMessage=result&&typeof result==='object'&&(typeof result.error==='string'?result.error:typeof result.message==='string'?result.message:'');
  throw new CareRequestError(serverMessage||(response.status===429?'Too many attempts. Wait a moment and try again.':response.status>=500?'The care service is temporarily unavailable. Please try again.':`This request could not be completed (${response.status}).`),{status:response.status,code:result?.code,availableRoles:result?.availableRoles,retryAfter:result?.retryAfter});
 }
 return result;
}
