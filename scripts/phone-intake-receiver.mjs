/** A care-text-filtered, loopback-only incoming SMS receiver. No inbox scanning,
 * permission grants or automatic telephone calls. SMS alerts are opt-in. */
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {verifyGatewayEnvelope} from '../lib/phone-intake.mjs';
import {signBridgeRequest,androidSmsRequest,androidSmsStatus,probeAndroidGateway} from '../lib/telephony.mjs';
import {relayRole} from '../lib/relay-role.mjs';
import {createHash} from 'node:crypto';

const read=file=>existsSync(file)?parseEnv(readFileSync(file,'utf8')):{};
const env={...read('.dev.vars.android-relay'),...read('.dev.vars.phone-intake'),...process.env};
const flags=new Set(process.argv.slice(2));
if([...flags].some(flag=>!['--check','--pair','--register'].includes(flag)))throw Error('Use --check, --pair, --register, or no option to start the receiver.');
const origin=new URL(env.SAMARTH_PHONE_INTAKE_APP_URL||'http://127.0.0.1:5173');
const loopback=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
if((origin.protocol!=='https:'&&!loopback(origin))||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Use the exact HTTPS care origin, or loopback for this local demo.');
const port=Number(env.SAMARTH_PHONE_INTAKE_PORT||8089),sim=Number(env.SAMARTH_ANDROID_SIM_SLOT||2);
if(!Number.isInteger(port)||port<1024||port>65535||![1,2].includes(sim))throw Error('Configure a valid local listener port and SIM slot.');
const configured={gatewaySigningKey:typeof env.SAMARTH_ANDROID_WEBHOOK_SIGNING_KEY==='string'&&env.SAMARTH_ANDROID_WEBHOOK_SIGNING_KEY.length>=16,
 bridgeSecret:typeof env.SAMARTH_ANDROID_BRIDGE_SECRET==='string'&&env.SAMARTH_ANDROID_BRIDGE_SECRET.length>=32,
 account:!!env.SAMARTH_RELAY_EMAIL&&!!env.SAMARTH_RELAY_PASSWORD,
 gatewayAccount:!!env.SAMARTH_ANDROID_GATEWAY_USERNAME&&!!env.SAMARTH_ANDROID_GATEWAY_PASSWORD};
if(flags.has('--check')){console.log(JSON.stringify({incomingSmsReadyToConfigure:Object.values(configured).every(Boolean),configured,listener:'loopback only',sim,readsInbox:false,sendsSms:false,placesCalls:false},null,2));process.exit(Object.values(configured).every(Boolean)?0:2);}
if(flags.has('--pair')){
 const adb=env.SAMARTH_ADB_PATH||(existsSync('.local-tools/platform-tools/adb.exe')?'.local-tools/platform-tools/adb.exe':'adb');
 const listing=execFileSync(adb,['devices'],{encoding:'utf8',windowsHide:true});
 const devices=listing.split(/\r?\n/).filter(line=>/\tdevice\s*$/.test(line));
 if(devices.length!==1)throw Error('Connect and authorize exactly one intended Android phone.');
 execFileSync(adb,['forward','tcp:8080','tcp:8080'],{windowsHide:true});
 execFileSync(adb,['reverse',`tcp:${port}`,`tcp:${port}`],{windowsHide:true});
 console.log('USB gateway and incoming-SMS loopback ports are paired. No phone content was read.');
 if(!flags.has('--register'))process.exit(0);
}
if(!Object.values(configured).every(Boolean))throw Error('Complete the private .dev.vars.phone-intake settings. The phone gateway signing key is required; no SMS has been read or sent.');
const gateway=new URL(env.SAMARTH_ANDROID_GATEWAY_URL||'http://127.0.0.1:8080');
if(!loopback(gateway)||!['http:','https:'].includes(gateway.protocol)||gateway.username||gateway.password||gateway.pathname!=='/'||gateway.search||gateway.hash)throw Error('The phone gateway must stay on the USB loopback origin.');
if(flags.has('--register')){
 const headers={Authorization:'Basic '+Buffer.from(`${env.SAMARTH_ANDROID_GATEWAY_USERNAME}:${env.SAMARTH_ANDROID_GATEWAY_PASSWORD}`).toString('base64'),'content-type':'application/json'};
 const url=`http://127.0.0.1:${port}/sms`;
 const existing=await fetch(new URL('/webhooks',gateway),{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!existing.ok)throw Error('The gateway could not list its local webhook registrations.');
 const list=await existing.json();if(!Array.isArray(list))throw Error('The gateway returned an unexpected webhook list.');
 for(const event of ['sms:received','mms:downloaded'])if(!list.some(item=>item.event===event&&item.url===url)){
  const response=await fetch(new URL('/webhooks',gateway),{method:'POST',headers,body:JSON.stringify({event,url}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('The gateway did not accept the incoming-SMS registration.');
 }
 console.log('Incoming SMS and text-only MMS webhooks registered. No historical messages were requested. Start the receiver before testing.');process.exit(0);
}

let cookies=new Map(),loginPending=null,refreshAfter=0;
const eligibleSenders=new Map();
async function isCheckinSender(sender){
 const senderHash=createHash('sha256').update(sender).digest('hex');
 const prior=eligibleSenders.get(senderHash);if(prior&&prior.expires>Date.now())return prior.eligible;
 const result=await api('sms-checkins/bridge/eligible',{senderHash},true);
 if(typeof result.eligible!=='boolean')throw Error('Sender eligibility is unavailable.');
 if(eligibleSenders.size>1000)eligibleSenders.clear();
 eligibleSenders.set(senderHash,{eligible:result.eligible,expires:Date.now()+60000});return result.eligible;
}
async function api(path,body,signed=false,renewSession=true){
 const raw=JSON.stringify(body),pathname='/api/'+path;
 const proof=signed?await signBridgeRequest({method:'POST',path:pathname,body:raw,secret:env.SAMARTH_ANDROID_BRIDGE_SECRET}):{};
 const response=await fetch(new URL(pathname,origin),{method:'POST',headers:{...proof,Origin:origin.origin,'content-type':'application/json',Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')},body:raw,redirect:'error',signal:AbortSignal.timeout(20000)});
 for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));}
 const result=await response.json();
 if(response.status===401&&renewSession&&!['auth/login','session'].includes(path)){
  if(loginPending)await loginPending;
  else if(Date.now()>=refreshAfter){refreshAfter=Date.now()+60000;await login();}
  else throw Object.assign(Error('Care account reauthentication is waiting before retrying.'),{status:401});
  return api(path,body,signed,false);
 }
 if(!response.ok)throw Object.assign(Error('The care server did not confirm the incoming request.'),{status:response.status});return result;
}
async function login(){
 if(loginPending)return loginPending;
 loginPending=(async()=>{const role=relayRole(env);await api('auth/login',{email:env.SAMARTH_RELAY_EMAIL,password:env.SAMARTH_RELAY_PASSWORD,role});await api('session',{role});})();
 try{await loginPending;}finally{loginPending=null;}
}
await login();
let sending=false,lastAlertError='',lastAlertErrorAt=0;
const alertHealth={lastCheckAt:null,lastSuccessAt:null,errorStage:null,errorStatus:null};
const receiptWatchers=new Set();
async function watchReceipt(job,checkin,initial){
 if(receiptWatchers.has(job.id)||['delivered','failed','cancelled'].includes(initial.status))return;
 receiptWatchers.add(job.id);
 try{
  let proof=initial;
  for(let attempt=0;attempt<24&&!['delivered','failed','cancelled'].includes(proof.status);attempt++){
   await new Promise(resolve=>setTimeout(resolve,5000));
   const next=await androidSmsStatus(job,env);
   if(next.status!==proof.status){
    await api(checkin?'sms-checkins/bridge/receipt':`telephony/jobs/${job.id}/receipt`,{...(checkin?{id:job.id}:{}),leaseToken:job.leaseToken,providerId:job.id,status:next.status},true);
    proof=next;
   }
  }
 }catch{console.error('A later SMS receipt could not be confirmed. The saved send state remains; no message is resent.');}
 finally{receiptWatchers.delete(job.id);}
}
async function sendCareAlerts(){
 if(sending||env.SAMARTH_PHONE_INTAKE_SEND_ALERTS!=='true')return;sending=true;
 let stage='gateway';alertHealth.lastCheckAt=new Date().toISOString();
 try{
  await probeAndroidGateway(env);
  stage='heartbeat';
  await api('telephony/bridge/heartbeat',{deviceReady:true},true);
  stage='queue';
  const {jobs}=await api('phone-intake/outbound',{},true);
  const questions=await api('sms-checkins/bridge/outbound',{},true);
  const pendingJobs=[...(jobs||[]),...(questions.jobs||[]).map(job=>({...job,checkin:true}))];
  for(const pending of pendingJobs.slice(0,1)){
   stage='claim';
   const claimed=await api(pending.checkin?'sms-checkins/bridge/claim':`telephony/jobs/${pending.id}/claim`,pending.checkin?{id:pending.id}:pending.receiptOnly?{receiptOnly:true}:{},true);
   if(claimed.blocked)continue;
   const {job}=claimed;
   if(job.channel!=='sms')throw Error('Phone intake only sends the approved SMS alert channel.');
   stage='send';
   const proof=await (job.receiptOnly?androidSmsStatus(job,env):androidSmsRequest(job,env));
   const receipt=()=>{stage='receipt';return api(pending.checkin?'sms-checkins/bridge/receipt':`telephony/jobs/${job.id}/receipt`,{...(pending.checkin?{id:job.id}:{}),leaseToken:job.leaseToken,providerId:job.id,status:proof.status},true);};
   await receipt();
   // Delivery-report waiting must not hold the next senior's alert in the queue.
   void watchReceipt(job,pending.checkin,proof);
   console.log('Approved care SMS processed. Consult the saved delivery status; no read or answered-call status is inferred.');
  }
  alertHealth.lastSuccessAt=new Date().toISOString();alertHealth.errorStage=null;alertHealth.errorStatus=null;
  if(lastAlertError)console.log('Phone-request SMS notification worker connection restored.');lastAlertError='';
 }catch(error){
  const status=Number.isInteger(error.status)?error.status:null;
  alertHealth.errorStage=stage;alertHealth.errorStatus=status;
  const category=`${stage}:${status||'connection'}`;
  if(category!==lastAlertError||Date.now()-lastAlertErrorAt>=60000){console.error(`Phone-request SMS worker could not complete ${stage} (${status||'connection error'}). Delivery has not been confirmed.`);lastAlertErrorAt=Date.now();}lastAlertError=category;
 }
 finally{sending=false;}
}
const diagnostics={startedAt:new Date().toISOString(),webhooks:0,stored:0,ignored:0,rejected:0,lastWebhookAt:null,lastResult:null,ipv6Loopback:false};
const handleIncoming=async(request,response)=>{
 const reply=(status,value)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
 if(request.method==='GET'&&request.url==='/health')return reply(200,{listening:true,...diagnostics,alertWorker:{enabled:env.SAMARTH_PHONE_INTAKE_SEND_ALERTS==='true',...alertHealth,pendingReceiptChecks:receiptWatchers.size}});
 if(request.method!=='POST'||request.url!=='/sms')return reply(404,{error:'Not found.'});
 diagnostics.webhooks++;diagnostics.lastWebhookAt=new Date().toISOString();
 const rejected=(status)=>{diagnostics.rejected++;diagnostics.lastResult=`rejected_${status}`;console.error(`Incoming SMS webhook rejected (${status}). No message content is logged.`);};
 try{
  if(!request.headers['content-type']?.includes('application/json')){rejected(415);return reply(415,{error:'Use signed JSON.'});}
  let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>16384){rejected(413);return reply(413,{error:'Message too large.'});}chunks.push(chunk);}
  const raw=Buffer.concat(chunks).toString('utf8'),headers=new Headers();
  for(const name of ['x-signature','x-timestamp'])if(typeof request.headers[name]==='string')headers.set(name,request.headers[name]);
  const event=await verifyGatewayEnvelope(raw,headers,env.SAMARTH_ANDROID_WEBHOOK_SIGNING_KEY,{expectedSim:sim,allowCheckins:true});
  if(event.ignored){diagnostics.ignored++;diagnostics.lastResult=event.reason;console.log(`Incoming SMS webhook ignored (${event.reason}). No message content is logged.`);return reply(200,{ignored:true});}
  if(event.kind==='checkin'&&!await isCheckinSender(event.sender)){
   diagnostics.ignored++;diagnostics.lastResult='no_care_contact';return reply(200,{ignored:true});
  }
  const saved=await api('phone-intake/receive',event,true);
  if(saved.ok!==true||typeof saved.id!=='string')throw Error('No durable intake receipt.');
  diagnostics.stored++;diagnostics.lastResult=saved.replayed?'stored_replay':'stored';
  console.log(saved.replayed?'Repeated SMS receipt matched its saved request.':'Incoming care request saved to the cloud.');
  return reply(200,{stored:true,replayed:saved.replayed===true});
 }catch(error){const status=[400,401,413].includes(error.status)?error.status:503;rejected(status);return reply(status,{stored:false});}
};
const server=createServer(handleIncoming),ipv6Server=createServer(handleIncoming);
for(const listener of [server,ipv6Server]){listener.requestTimeout=25000;listener.headersTimeout=10000;listener.maxHeadersCount=30;}
// Some Windows ADB servers connect reverse TCP sockets to ::1. Bind both
// loopback addresses explicitly; never expose the receiver on all interfaces.
ipv6Server.on('error',()=>console.error('IPv6 loopback is unavailable. The IPv4 receiver remains active.'));
ipv6Server.listen({port,host:'::1',ipv6Only:true},()=>{diagnostics.ipv6Loopback=true;});
server.listen(port,'127.0.0.1',()=>{console.log('Phone intake receiver is listening on USB loopback. Only signed care-related SMS from the selected SIM is forwarded.');if(env.SAMARTH_PHONE_INTAKE_SEND_ALERTS==='true'){void sendCareAlerts();setInterval(()=>void sendCareAlerts(),10000);}});
