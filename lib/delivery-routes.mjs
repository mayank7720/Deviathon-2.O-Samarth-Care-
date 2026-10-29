import {canManageCare} from './access.mjs';
import webpush from 'web-push';
import { workflow } from './workflow-store.mjs';

const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function check(ok,status,message){if(!ok){const e=new Error(message);e.status=status;throw e;}}
const hostAllowed=host=>host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host==='web.push.apple.com'||host.endsWith('.notify.windows.com');
export function validateSubscription(subscription) {
  let url;try{url=new URL(subscription?.endpoint);}catch{check(false,400,'Invalid browser push endpoint.');}
  check(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&hostAllowed(url.hostname),400,'This browser push service is not supported.');
  check(subscription.endpoint.length<=2048&&/^[A-Za-z0-9_-]{80,100}$/.test(subscription.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{20,30}$/.test(subscription.keys?.auth||''),400,'Invalid browser push encryption keys.');
  const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
  let publicKey,auth;try{publicKey=decode(subscription.keys.p256dh);auth=decode(subscription.keys.auth);}catch{check(false,400,'Invalid browser push encryption keys.');}
  check(publicKey.length===65&&publicKey[0]===4&&auth.length===16,400,'Invalid browser push encryption keys.');
  return {endpoint:url.href,expirationTime:subscription.expirationTime||null,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
}
async function stableId(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function currentConsents(db,owner,defaults) {const combined=new Map(defaults.map(c=>[c.senior_id,c]));for(const row of await workflow(db,'consents_get',{owner}))combined.set(row.senior_id,row);return [...combined.values()];}
const userIdFor=context=>context.identity?.userId||context.userId||context.session?.userId;
const scopeFor=session=>Array.isArray(session.scope)?session.scope:[];
export async function processDeliveries({db,context,env={},consents=[],fetchImpl=fetch,limit=100}) {
  const {owner}=context;
  consents=await currentConsents(db,owner,consents);
  const scope=scopeFor(context.session);
  const expiredBefore=new Date(Date.now()-5*60000).toISOString();
  const all=await workflow(db,'deliveries_get',{owner,limit:Math.min(100,limit),statuses:['queued','failed','processing'],maxAttempts:3,availableBefore:expiredBefore,seniorIds:scope.includes('*')?null:scope});
  const members=await workflow(db,'members_get',{workspaceId:context.workspaceId||'primary'});
  const result={delivered:0,failed:0,blocked:0};
  for(const item of all.filter(d=>['queued','failed','processing'].includes(d.status)&&d.attempts<3).slice(0,limit)) {
    const member=members.find(m=>m.user_id===item.user_id&&m.role===item.recipient_role&&(m.role!=='family'||m.senior_id===item.senior_id||(typeof m.scope_json==='string'?JSON.parse(m.scope_json):m.scope_json||[]).includes(item.senior_id)));
    const scope=member?(typeof member.scope_json==='string'?JSON.parse(member.scope_json):member.scope_json||[]):[];
    const consent=consents.find(c=>c.senior_id===item.senior_id);
    const allowed=member&&(member.role==='family'?(member.senior_id===item.senior_id||scope.includes(item.senior_id))&&!!consent?.allowed:scope.includes('*')||scope.includes(item.senior_id));
    if(!allowed){await workflow(db,'delivery_update',{owner,id:item.id,status:'blocked_consent',attempts:item.attempts,lastError:'Recipient access or family consent is no longer active.'});result.blocked++;continue;}
    const claim=await workflow(db,'delivery_claim',{owner,id:item.id,attempts:item.attempts,claimedAt:new Date().toISOString(),expiredBefore});
    if(!claim?.claimed)continue;
    try {
      if(item.channel==='web_push') {
        check(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY,503,'Browser notification keys are not configured.');
        const subscriptions=await workflow(db,'push_get',{owner,userId:item.user_id});
        check(subscriptions.length,409,'Recipient has no active browser subscription.');
        let sent=0;
        for(const row of subscriptions) {
          const subscription=validateSubscription(row.subscription);
          const details=webpush.generateRequestDetails(subscription,JSON.stringify({title:'Samarth Care update',body:'Open your care inbox for an update.',url:'/',tag:'samarth-care-update'}),{TTL:3600,vapidDetails:{subject:env.VAPID_SUBJECT||'mailto:notifications@example.invalid',publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY}});
          const response=await fetchImpl(details.endpoint,{method:details.method,headers:details.headers,body:details.body,redirect:'manual',signal:AbortSignal.timeout(12000)});
          if([404,410].includes(response.status))await workflow(db,'push_delete',{owner,userId:item.user_id,endpoint:subscription.endpoint});
          if(response.ok)sent++;
        }
        check(sent>0,503,'Push service did not accept the notification.');
      }
      await workflow(db,'delivery_update',{owner,id:item.id,status:'delivered',attempts:item.attempts+1,deliveredAt:new Date().toISOString()});result.delivered++;
    }catch(error){await workflow(db,'delivery_update',{owner,id:item.id,status:'failed',attempts:item.attempts+1,lastError:error.status?error.message:'Notification delivery failed; retry is available.'});result.failed++;}
  }
  return result;
}
export async function handleDeliveryRoute({path,request,body={},db,context,env={},consents=[]}) {
  if(!['deliveries','deliveries/process','push/config','push/subscriptions'].includes(path)&&!path.startsWith('deliveries/'))return null;
  const {session,owner}=context,isStaff=['coordinator','operations'].includes(session.role);
  try {
    check(session&&userIdFor(context),401,'Sign in to your care workspace.');
    const userId=userIdFor(context),scope=scopeFor(session);
    if(path==='push/config'&&request.method==='GET')return reply({enabled:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY),publicKey:env.VAPID_PUBLIC_KEY||null});
    if(path==='push/subscriptions'&&request.method==='POST') {
      const subscription=validateSubscription(body.subscription);
      await workflow(db,'push_put',{id:await stableId(`${owner}:${userId}:${subscription.endpoint}`),owner,userId,subscription,createdAt:new Date().toISOString()});return reply({ok:true},201);
    }
    if(path==='push/subscriptions'&&request.method==='DELETE') {check(typeof body.endpoint==='string'&&body.endpoint.length<=2048,400,'Provide the subscription endpoint.');await workflow(db,'push_delete',{owner,userId,endpoint:body.endpoint});return reply({ok:true});}
    if(path==='deliveries/process'&&request.method==='POST') {check(canManageCare(session),403,'Only a care coordinator can process deliveries.');return reply(await processDeliveries({db,context,env,consents}));}
    if(path==='deliveries'&&request.method==='GET') {
      const url=new URL(request.url),limit=Math.min(100,Math.max(1,Math.trunc(Number(url.searchParams.get('limit')))||100));
      let cursor=url.searchParams.get('cursor')||undefined,cursorId='';
      if(cursor?.startsWith('[')){try{[cursor,cursorId]=JSON.parse(cursor);check(typeof cursor==='string'&&typeof cursorId==='string',400,'Invalid delivery cursor.');}catch{check(false,400,'Invalid delivery cursor.');}}
      let deliveries=await workflow(db,'deliveries_get',{owner,limit:limit+1,cursor,cursorId,seniorIds:isStaff&&!scope.includes('*')?scope:null,userId:isStaff?null:userId,recipientRole:isStaff?null:session.role,statuses:isStaff?null:['delivered','read']});
      deliveries=deliveries.filter(d=>isStaff?(scope.includes('*')||scope.includes(d.senior_id)):d.user_id===userId&&d.recipient_role===session.role);
      consents=await currentConsents(db,owner,consents);
      deliveries=deliveries.filter(d=>session.role!=='family'||consents.some(c=>c.senior_id===d.senior_id&&c.allowed));
      const page=deliveries.slice(0,limit).map(d=>({id:d.id,seniorId:d.senior_id,recipientRole:d.recipient_role,kind:d.kind,channel:d.channel,status:d.status,createdAt:d.created_at,deliveredAt:d.delivered_at,readAt:d.read_at,attempts:d.attempts,lastError:d.last_error,...d.payload}));
      return reply({deliveries:page,nextCursor:deliveries.length>limit?JSON.stringify([page.at(-1).createdAt,page.at(-1).id]):null});
    }
    if(path.startsWith('deliveries/')&&request.method==='PATCH') {
      const id=decodeURIComponent(path.slice('deliveries/'.length)),item=await workflow(db,'delivery_get',{owner,id});
      if(body.approve===true) {
        check(canManageCare(session),403,'Only a care coordinator can approve a weekly update.');
        check(item&&(scope.includes('*')||scope.includes(item.senior_id)),404,'Delivery not found within your assigned care scope.');
        check(item.kind==='weekly_summary'&&item.status==='pending_review',409,'This update is not awaiting review.');
        consents=await currentConsents(db,owner,consents);
        check(item.recipient_role!=='family'||consents.some(c=>c.senior_id===item.senior_id&&c.allowed),403,'Family sharing consent is not enabled.');
        await workflow(db,'delivery_update',{owner,id,status:'queued',attempts:item.attempts,lastError:null});
        if(item.channel==='in_app') {
          // Publishing a reviewed inbox update needs no device, push provider,
          // or second background-processing click.
          const claimed=await workflow(db,'delivery_claim',{owner,id,attempts:item.attempts,claimedAt:new Date().toISOString(),expiredBefore:new Date(Date.now()-5*60000).toISOString()});
          if(claimed?.claimed){await workflow(db,'delivery_update',{owner,id,status:'delivered',attempts:item.attempts+1,deliveredAt:new Date().toISOString()});return reply({ok:true,status:'delivered'});}
        }
        return reply({ok:true,status:'queued'});
      }
      check(item&&item.user_id===userId&&item.recipient_role===session.role,404,'Delivery not found for this recipient.');
      check(body.read===true,400,'Choose read:true.');
      check(item.channel==='in_app'&&['delivered','read'].includes(item.status),409,'Only a delivered inbox message can be marked as read.');
      consents=await currentConsents(db,owner,consents);
      check(session.role!=='family'||consents.some(c=>c.senior_id===item.senior_id&&c.allowed),403,'Family sharing consent is not enabled.');
      await workflow(db,'delivery_read',{owner,id,userId,recipientRole:session.role,readAt:new Date().toISOString()});return reply({ok:true});
    }
    return reply({error:'Method not supported.'},405);
  }catch(error){return reply({error:error.status?error.message:'Unable to process care delivery.'},error.status||500);}
}
