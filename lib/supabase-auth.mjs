/** Standalone, server-mediated Supabase Auth. No session tokens reach browser JS. */
export class SupabaseAuthError extends Error {
  constructor(status, message, details = {}) {
    super(message); this.status = status;
    if(typeof details.code==='string')this.code=details.code;
    if(Array.isArray(details.availableRoles))this.availableRoles=[...new Set(details.availableRoles.filter(role=>PORTAL_ROLES.includes(role)))];
    if(Number.isInteger(details.retryAfter)&&details.retryAfter>0&&details.retryAfter<=86400)this.retryAfter=details.retryAfter;
  }
}
const check = (condition, status, message) => { if (!condition) throw new SupabaseAuthError(status, message); };
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const ACCESS_COOKIE = 'samarth_sb_access';
const REFRESH_COOKIE = 'samarth_sb_refresh';
const refreshes = new Map();
const PORTAL_ROLES=['coordinator','operations','family','senior'];
const PUBLIC_SIGNUP_ROLES=['family','senior'];

export function supabaseConfiguration(env = {}) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || '');
  check(url && publishableKey, 503, 'Supabase login is not configured. Set the project URL and publishable key on the server.');
  let parsed; try { parsed = new URL(url); } catch { throw new SupabaseAuthError(503, 'The configured Supabase URL is invalid.'); }
  check(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)), 503, 'Supabase must use HTTPS outside local development.');
  check(!parsed.username && !parsed.password && !parsed.search && !parsed.hash, 503, 'The Supabase URL must be a project origin.');
  check(!publishableKey.startsWith('sb_secret_'), 503, 'A publishable key is required; never use a secret key for user requests.');
  if (publishableKey.startsWith('eyJ')) {
    try { const claims = JSON.parse(atob(publishableKey.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); check(claims.role === 'anon', 503, 'Only a publishable or legacy anon key is allowed for user requests.'); }
    catch (error) { if (error instanceof SupabaseAuthError) throw error; throw new SupabaseAuthError(503, 'The configured public API key is invalid.'); }
  }
  return { url, publishableKey };
}
function cookiesFromRequest(request) {
  const found = new Map();
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('='); if(index < 0)continue;
    const key = part.slice(0,index).trim(), value = part.slice(index+1).trim();
    if([ACCESS_COOKIE,REFRESH_COOKIE].includes(key) && value.length <= 12000 && /^[A-Za-z0-9._~-]*$/.test(value))found.set(key,value);
  }
  return found;
}
function sessionCookie(request, name, value, age) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function clearSupabaseCookies(request) { return [sessionCookie(request,ACCESS_COOKIE,'',0),sessionCookie(request,REFRESH_COOKIE,'',0)]; }
function tokenCookies(request, tokens) {
  check(typeof tokens.access_token==='string' && typeof tokens.refresh_token==='string' && /^[A-Za-z0-9._~-]+$/.test(tokens.access_token) && /^[A-Za-z0-9._~-]+$/.test(tokens.refresh_token),502,'The authentication service returned an invalid session.');
  return [sessionCookie(request, ACCESS_COOKIE, tokens.access_token, Math.min(86400,Math.max(60,Number(tokens.expires_in)||3600))), sessionCookie(request,REFRESH_COOKIE,tokens.refresh_token,30*86400)];
}
export function withSupabaseCookies(response, cookies = []) { for(const cookie of cookies)response.headers.append('set-cookie',cookie); return response; }
function reply(data,status=200,cookies=[],headers={}) {const response=new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...headers}});return withSupabaseCookies(response,cookies);}
function providerRetryAfter(response) {
  const raw=response.headers.get('retry-after');
  const seconds=raw&&/^\d+$/.test(raw)?Number(raw):raw?Math.ceil((Date.parse(raw)-Date.now())/1000):60;
  return Number.isFinite(seconds)?Math.max(1,Math.min(86400,seconds)):60;
}
async function provider(config,path,{method='GET',body,accessToken,fetchImpl=fetch}={}) {
  const response=await fetchImpl(`${config.url}/auth/v1${path}`,{method,headers:{apikey:config.publishableKey,...(accessToken?{Authorization:`Bearer ${accessToken}`}:{ }),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(response.status===429)throw new SupabaseAuthError(429,'Too many sign-in attempts. Wait before trying again.',{code:'AUTH_RATE_LIMITED',retryAfter:providerRetryAfter(response)});
  if(response.status>=500)throw new SupabaseAuthError(503,'The authentication service is temporarily unavailable. Please try again shortly.',{code:'AUTH_SERVICE_UNAVAILABLE'});
  let data;
  if(response.status===204)data={};
  else {try{data=await response.json();}catch{throw new SupabaseAuthError(502,'The authentication service returned an unreadable response. Please try again.',{code:'AUTH_INVALID_RESPONSE'});}}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SupabaseAuthError(502,'The authentication service returned an invalid response. Please try again.',{code:'AUTH_INVALID_RESPONSE'});
  return {response,data};
}
async function portalAccess(config,accessToken,userId,fetchImpl){
  const headers={apikey:config.publishableKey,Authorization:`Bearer ${accessToken}`,'content-type':'application/json'};
  const [members,state]=await Promise.all([
    fetchImpl(`${config.url}/rest/v1/care_memberships?select=role,is_admin,status&workspace_id=eq.primary&user_id=eq.${encodeURIComponent(userId)}&status=eq.active`,{headers,redirect:'error',signal:AbortSignal.timeout(12000)}),
    fetchImpl(`${config.url}/rest/v1/rpc/care_account_self_state`,{method:'POST',headers,body:'{}',redirect:'error',signal:AbortSignal.timeout(12000)}),
  ]);
  check(members.ok&&state.ok,503,'Account access could not be verified. Please try again.');
  const [memberships,account]=await Promise.all([members.json(),state.json()]);
  check(Array.isArray(memberships)&&account&&typeof account.enabled==='boolean',503,'Account access could not be verified. Please try again.');
  check(account.enabled&&!account.reauthenticationRequired,403,'This account is disabled or its sign-in details changed. Contact Operations.');
  return memberships.filter(item=>item.status==='active'&&PORTAL_ROLES.includes(item.role));
}
function identityFromUser(user) {
  if(!user?.id || !user?.email || !(user.email_confirmed_at || user.confirmed_at))return null;
  return {userId:String(user.id),email:String(user.email).toLowerCase(),name:String(user.user_metadata?.display_name || user.user_metadata?.full_name || user.email.split('@')[0]).slice(0,120),emailVerified:true};
}

/** This calls Auth's authoritative user endpoint; decoded browser JWT claims are never trusted. */
export async function resolveSupabaseRequest(request,env={}, {fetchImpl=fetch}={}) {
  const config=supabaseConfiguration(env), cookies=cookiesFromRequest(request);
  let accessToken=cookies.get(ACCESS_COOKIE)||null, refreshToken=cookies.get(REFRESH_COOKIE)||null, newCookies=[];
  if(!accessToken && !refreshToken)return {identity:null,accessToken:null,cookies:[],authMode:'supabase'};
  try {
    let verified=accessToken?await provider(config,'/user',{accessToken,fetchImpl}):null;
    if(!verified?.response.ok && refreshToken) {
      let refresh=refreshes.get(refreshToken);
      if(!refresh){refresh=provider(config,'/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshToken},fetchImpl});refreshes.set(refreshToken,refresh);}
      let refreshed;try{refreshed=await refresh;}finally{if(refreshes.get(refreshToken)===refresh)refreshes.delete(refreshToken);}
      if(!refreshed.response.ok)return {identity:null,accessToken:null,cookies:clearSupabaseCookies(request),authMode:'supabase'};
      accessToken=refreshed.data.access_token;newCookies=tokenCookies(request,refreshed.data);
      verified=await provider(config,'/user',{accessToken,fetchImpl});
    }
    const identity=verified?.response.ok?identityFromUser(verified.data):null;
    if(!identity)return {identity:null,accessToken:null,cookies:clearSupabaseCookies(request),authMode:'supabase'};
    return {identity,accessToken,cookies:newCookies,authMode:'supabase'};
  } catch(error) {
    if(error instanceof SupabaseAuthError)throw error;
    throw new SupabaseAuthError(503,'The authentication service is temporarily unavailable. No care records were opened.');
  }
}

function validateMutation(request) {
  check(request.headers.get('content-type')?.includes('application/json'),415,'Send application/json.');
  const url=new URL(request.url),origin=request.headers.get('origin');
  check(!origin || origin===url.origin,403,'Cross-origin authentication changes are not allowed.');
  check(!request.headers.get('sec-fetch-site') || ['same-origin','none'].includes(request.headers.get('sec-fetch-site')),403,'Cross-origin authentication changes are not allowed.');
  check(url.protocol==='https:' || ['localhost','127.0.0.1','[::1]'].includes(url.hostname),400,'Sign-in requires HTTPS outside local development.');
}
export async function handleSupabaseAuthRoute(path,request,body,env={}, {fetchImpl=fetch}={}) {
  if(!['auth/login','auth/register','auth/logout','auth/refresh','auth/password'].includes(path))return null;
  const rejectedCookies=()=>[...clearSupabaseCookies(request),sessionCookie(request,'samarth_session','',0)];
  if(request.method!=='POST')return reply({error:'Use POST for this authentication action.'},405,rejectedCookies());
  let issuedAccessToken=null,config;
  try {
    validateMutation(request); config=supabaseConfiguration(env);
    if(path==='auth/password') {
      check(body&&typeof body==='object'&&!Array.isArray(body),400,'Enter your current and new passwords.');
      check(typeof body.currentPassword==='string'&&body.currentPassword.length>=8&&body.currentPassword.length<=128,400,'Enter your current password.');
      check(typeof body.newPassword==='string'&&body.newPassword.length>=12&&body.newPassword.length<=128,400,'Use a new password between 12 and 128 characters.');
      check(body.newPassword!==body.currentPassword,400,'Choose a different new password.');
      const resolved=await resolveSupabaseRequest(request,env,{fetchImpl});
      check(resolved.identity&&resolved.accessToken,401,'Sign in before changing your password.');
      await portalAccess(config,resolved.accessToken,resolved.identity.userId,fetchImpl);
      const verified=await provider(config,'/token?grant_type=password',{method:'POST',body:{email:resolved.identity.email,password:body.currentPassword},fetchImpl});
      check(verified.response.ok,401,'Your current password is incorrect.');
      issuedAccessToken=verified.data.access_token;
      const fresh=await provider(config,'/user',{accessToken:issuedAccessToken,fetchImpl});
      check(fresh.response.ok&&identityFromUser(fresh.data)?.userId===resolved.identity.userId,401,'Your current password could not be verified.');
      const updated=await provider(config,'/user',{method:'PUT',body:{password:body.newPassword,current_password:body.currentPassword},accessToken:issuedAccessToken,fetchImpl});
      check(updated.response.ok,updated.data?.code==='weak_password'?400:409,updated.data?.code==='weak_password'?'Choose a stronger password of at least 12 characters.':'The password could not be changed. Please try again or contact Operations.');
      // Only a credential timestamp is stored in the care database. Passwords
      // are sent directly to Auth and never enter care events or audit payloads.
      let revoked=false;
      try {
        const result=await fetchImpl(`${config.url}/rest/v1/rpc/care_password_changed`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${issuedAccessToken}`,'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(12000)});
        revoked=result.ok;
      } catch {/* Global Auth sign-out is still attempted below. */}
      try {await provider(config,'/logout?scope=global',{method:'POST',accessToken:issuedAccessToken,fetchImpl});}catch{/* The care credential cutoff independently blocks old care sessions. */}
      issuedAccessToken=null;
      return reply({ok:true,passwordChanged:true,signInRequired:true,...(!revoked?{warning:'Your password changed. Contact Operations if another device remains signed in.'}:{})},200,rejectedCookies());
    }
    if(path==='auth/logout') {
      const token=cookiesFromRequest(request).get(ACCESS_COOKIE);
      if(token) {try {await provider(config,'/logout?scope=local',{method:'POST',accessToken:token,fetchImpl});}catch{/* Always clear the browser session even when the provider is offline. */}}
      return reply({ok:true,signOutUrl:'/'},200,[...clearSupabaseCookies(request),sessionCookie(request,'samarth_session','',0)]);
    }
    if(path==='auth/refresh') {
      const resolved=await resolveSupabaseRequest(request,env,{fetchImpl});
      return reply({ok:!!resolved.identity,authenticated:!!resolved.identity},resolved.identity?200:401,resolved.cookies);
    }
    check(body&&typeof body==='object'&&!Array.isArray(body),400,'Provide sign-in details.');
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    check(email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Enter a valid email address.');
    check(typeof body.password==='string' && body.password.length>=8 && body.password.length<=128,400,'Use a password between 8 and 128 characters.');
    if(path==='auth/register') {
      check(env.SAMARTH_ALLOW_SIGNUP==='true',403,'Ask your care-team administrator for an account and role invitation.');
      check(PUBLIC_SIGNUP_ROLES.includes(body.role),403,'Only family members and seniors can create an account here. Staff accounts are managed by Operations.');
      const displayName=typeof body.displayName==='string'?body.displayName.trim():'';
      check(!displayName||displayName.length>=2&&displayName.length<=80,400,'Enter a name between 2 and 80 characters.');
      const result=await provider(config,'/signup',{method:'POST',body:{email,password:body.password,data:{...(displayName?{display_name:displayName}:{}),requested_role:body.role}},fetchImpl});
      check(result.response.ok,400,'Account registration could not be completed. Check the email or contact the administrator.');
      return reply({ok:true,confirmationRequired:true,message:'Confirm your email, then sign in and accept the invitation from your care-team administrator. No care role has been granted.'},201);
    }
    check(PORTAL_ROLES.includes(body.role),400,'Choose the portal for your assigned account.');
    const result=await provider(config,'/token?grant_type=password',{method:'POST',body:{email,password:body.password},fetchImpl});
    if(!result.response.ok)throw new SupabaseAuthError(401,'Invalid email or password, or the email has not been confirmed.',{code:'AUTH_INVALID_CREDENTIALS'});
    issuedAccessToken=result.data.access_token;
    const verified=await provider(config,'/user',{accessToken:result.data.access_token,fetchImpl});
    check(verified.response.ok && identityFromUser(verified.data),401,'Confirm your email before opening a care workspace.');
    const memberships=await portalAccess(config,result.data.access_token,verified.data.id,fetchImpl);
    if(!memberships.some(m=>m.role===body.role)&&!(memberships.length===0&&PUBLIC_SIGNUP_ROLES.includes(body.role)))throw new SupabaseAuthError(403,'These login details are not assigned to this portal. Choose your assigned account type.',{code:'PORTAL_ROLE_MISMATCH',availableRoles:memberships.map(member=>member.role)});
    return reply({ok:true,verified:true,authMode:'supabase'},200,tokenCookies(request,result.data));
  } catch(error) {
    if(issuedAccessToken&&config)try{await provider(config,'/logout?scope=local',{method:'POST',accessToken:issuedAccessToken,fetchImpl});}catch{/* Do not expose or retain a rejected portal session. */}
    if(!error.status)console.error('Supabase Auth transport failed', {name:error.name,code:error.cause?.code});
    const known=error instanceof SupabaseAuthError,code=known?error.code:'AUTH_SERVICE_UNAVAILABLE';
    return reply({error:known?error.message:'The authentication service is temporarily unavailable.',...(code?{code}:{}),...(known&&error.availableRoles?{availableRoles:error.availableRoles}:{}),...(known&&error.retryAfter?{retryAfter:error.retryAfter}:{})},known?error.status:503,rejectedCookies(),known&&error.retryAfter?{'retry-after':String(error.retryAfter)}:{});
  }
}
