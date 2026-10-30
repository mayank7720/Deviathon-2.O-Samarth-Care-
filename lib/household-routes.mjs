/** Household changes use a checked database transaction; no role is granted from request fields. */
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export class HouseholdError extends Error {constructor(status,message){super(message);this.status=status;}}
const check=(condition,status,message)=>{if(!condition)throw new HouseholdError(status,message);};
async function tokenPair(){const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');const tokenHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(n=>n.toString(16).padStart(2,'0')).join('');return {token,tokenHash};}
export async function handleHouseholdRoute(path,request,db,body,context){
 if(path!=='household'&&!path.startsWith('household/'))return null;
 check(context.authenticated,401,'Sign in before managing household access.');
 check(context.authorized&&['family','senior'].includes(context.session?.role),403,'Household access is managed from a family or senior account.');
 check(typeof db.household==='function',503,'Household access requires the cloud care service.');
 const role=context.session.role;
 if(path==='household'&&request.method==='GET')return reply(await db.household('list',{role}));
 if(path==='household/invitations'&&request.method==='POST'){
  check(body&&typeof body==='object'&&!Array.isArray(body),400,'Provide an email and linked senior.');
  check(Object.keys(body).every(key=>['email','seniorId'].includes(key)),400,'Only an email and linked senior can be supplied.');
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  check(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Enter a valid email address.');
  check(/^S\d{3,6}$/.test(body.seniorId||'')&&context.session.scope?.includes(body.seniorId),403,'Choose a senior already linked to your account.');
  const {token,tokenHash}=await tokenPair(),id=crypto.randomUUID(),expiresAt=Date.now()+7*86400000;
  const result=await db.household('invite',{role,id,email,seniorId:body.seniorId,tokenHash,expiresAt});
  return reply({...result,id,inviteUrl:new URL('/invitations?role='+(role==='senior'?'family':'senior')+'#invite='+token,request.url).toString(),expiresAt,emailSent:false},201);
 }
 const invitation=/^household\/invitations\/([a-f0-9-]{36})$/i.exec(path);
 if(invitation&&request.method==='DELETE')return reply(await db.household('remove_invitation',{role,id:invitation[1]}));
 const link=/^household\/links\/([A-Za-z0-9_-]{1,120})$/.exec(path);
 if(link&&request.method==='DELETE'){
  check(body?.confirmRemove===true,400,'Confirm removal of this household link. The account and care history will remain.');
  return reply(await db.household('remove_link',{role,id:link[1]}));
 }
 return reply({error:'This household action is unavailable.'},405);
}
