/** Phone-first support intake. A caller's number identifies a possible care link,
 * never a login, diagnosis, or permission to read a care record. */
import {analyzeSms} from './sms-understanding.mjs';
import {checkinReply} from './sms-checkins.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hex=bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
export const PHONE_COMMANDS=Object.freeze({help:['HELP','SOS','मदद','सहायता','MADAD'],callback:['CALL','CALL ME','कॉल','फोन']});

export function normalizeCaller(value){
 if(typeof value!=='string'||value.length>40||!/^[+\d\s().-]+$/.test(value))return null;
 let phone=value.replace(/[\s().-]/g,'');
 if(/^\d{10}$/.test(phone))phone='+91'+phone;
 else if(/^91\d{10}$/.test(phone))phone='+'+phone;
 return /^\+[1-9]\d{7,14}$/.test(phone)?phone:null;
}

export function phoneCommand(value){
 if(typeof value!=='string'||value.length>1600||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value))return null;
 const message=value.normalize('NFKC').trim();
 const analysis=analyzeSms(message);
 return analysis&&analysis.intent!=='none'?{kind:analysis.intent,message,language:analysis.language==='en'?'en':'hi'}:null;
}

export async function verifyGatewayEnvelope(raw,headers,secret,{now=Date.now(),expectedSim=2,allowCheckins=false}={}){
 if(typeof secret!=='string'||secret.length<16||secret.length>512)fail('Configure the private gateway signing key before enabling incoming messages.',503);
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16384)fail('Incoming message is too large.',413);
 const timestamp=headers.get('x-timestamp')||'',signature=headers.get('x-signature')||'';
 if(!/^\d{10}$/.test(timestamp)||!/^[a-f\d]{64}$/iu.test(signature)||Math.abs(now-Number(timestamp)*1000)>300000)fail('The incoming gateway signature is invalid or expired.',401);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const expected=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw+timestamp)));
 let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^signature.toLowerCase().charCodeAt(i);
 if(mismatch)fail('The incoming gateway signature is invalid or expired.',401);
 let envelope;try{envelope=JSON.parse(raw);}catch{fail('The gateway payload is invalid.');}
 // Historical/batch exports, delivery receipts and arbitrary phone events do not
 // become new help requests. Unrelated personal messages never leave this relay.
 if(!['sms:received','mms:downloaded'].includes(envelope?.event))return {ignored:true,reason:'unsupported_event'};
 const payload=envelope.payload;
 if(!payload||payload.simNumber!==expectedSim)return {ignored:true,reason:'different_or_unknown_sim'};
 const transport=envelope.event==='mms:downloaded'?'mms':'sms';
 if(transport==='mms'&&(!Array.isArray(payload.attachments)||payload.attachments.length))return {ignored:true,reason:'mms_attachments_excluded'};
 const text=transport==='mms'?payload.body:payload.message;
 const command=phoneCommand(text)||(allowCheckins?checkinReply(text):null);
 if(!command)return {ignored:true,reason:'not_a_care_command'};
 const sender=normalizeCaller(payload.sender);
 if(!sender)return {ignored:true,reason:'unusable_sender'};
 for(const value of [envelope.id,envelope.deviceId,payload.messageId])if(typeof value!=='string'||!/^[A-Za-z\d_.:-]{1,160}$/u.test(value))fail('The incoming message identity is invalid.');
 const received=Date.parse(payload.receivedAt);
 if(typeof payload.receivedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(payload.receivedAt)||!Number.isFinite(received)||received>now+60000||now-received>86400000)fail('The incoming message time is invalid or older than one day.');
 // Include the received time: two physical HELP texts with identical content
 // must not disappear merely because the gateway uses a content-based ID.
 const identity=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([envelope.deviceId,payload.messageId,new Date(received).toISOString()]))));
 const {choice,code,...safeCommand}=command;void choice;void code;
 return {eventId:identity,channel:'sms',transport,sender,...safeCommand,receivedAt:new Date(received).toISOString(),delayed:now-received>300000};
}

export async function handlePhoneIntakeRoute({path,request,body={},rawBody,db,context,env={},now=Date.now()}){
 if(!['phone-intake','phone-intake/receive','phone-intake/contact','phone-intake/outbound'].includes(path)&&!/^phone-intake\/[a-f\d-]{36}\/action$/iu.test(path))return null;
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 try{
  if(!context?.authenticated||!context?.authorized||!context.session?.userId)fail('Sign in to your care account.',401);
  if(typeof db.phoneIntake!=='function')fail('Phone support has not been configured in this workspace.',503);
  if(request.method==='POST'&&(!body||typeof body!=='object'||Array.isArray(body)))fail('Use a valid phone support request.');
  const staff=['coordinator','operations'].includes(context.session.role);
  if(path==='phone-intake/contact'&&request.method==='GET'){
   const seniorId=new URL(request.url).searchParams.get('seniorId');
   if(!/^S\d{3,6}$/.test(seniorId||''))fail('Choose a senior.');
   const contact=await db.phoneIntake('contact',{seniorId});
   // Resolve household access before returning any configured support number.
   const smsHelpline=env.SAMARTH_PHONE_INTAKE_ENABLED==='true'?normalizeCaller(env.SAMARTH_PHONE_INTAKE_NUMBER):null;
   return reply({...contact,smsHelpline});
  }
  if(!staff)fail('Phone requests are available to the assigned care team.',403);
  if(path==='phone-intake'&&request.method==='GET')return reply(await db.phoneIntake('list',{}));
  if(path==='phone-intake/outbound'&&request.method==='POST'){
   if(env.SAMARTH_PHONE_INTAKE_ENABLED!=='true')fail('Incoming phone support is not enabled.',503);
   const {verifyBridgeRequest}=await import('./telephony.mjs');
   await verifyBridgeRequest(request,rawBody??JSON.stringify(body),env,now);
   return reply(await db.phoneIntake('outbound',{}));
  }
  if(path==='phone-intake/receive'&&request.method==='POST'){
   if(env.SAMARTH_PHONE_INTAKE_ENABLED!=='true')fail('Incoming phone support is not enabled.',503);
   const {verifyBridgeRequest}=await import('./telephony.mjs');
   const signed=await verifyBridgeRequest(request,rawBody??JSON.stringify(body),env,now);
   if(Object.keys(body).some(key=>!['eventId','channel','transport','sender','kind','message','language','receivedAt','delayed'].includes(key)))fail('An incoming phone request cannot select its senior or recipient.');
   if(body.channel!=='sms'||!['help','callback','checkin'].includes(body.kind)||!/^[a-f\d]{64}$/.test(body.eventId||''))fail('Use a verified incoming SMS request.');
   if(body.transport!==undefined&&!['sms','mms'].includes(body.transport))fail('Unsupported text-message transport.');
   const command=body.kind==='checkin'?checkinReply(body.message):phoneCommand(body.message),sender=normalizeCaller(body.sender),received=Date.parse(body.receivedAt);
   if(!sender||!command||command.kind!==body.kind||typeof body.receivedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(body.receivedAt)||!Number.isFinite(received)||received>now+60000||now-received>86400000)fail('The incoming SMS is invalid.');
   if(command.kind==='checkin'){
    if(typeof db.smsCheckins!=='function')fail('SMS check-ins are not configured.',503);
    return reply(await db.smsCheckins('receive',{eventId:body.eventId,sender,message:command.message,choice:command.choice,code:command.code,receivedAt:new Date(received).toISOString(),nonce:signed.id}),201);
   }
   return reply(await db.phoneIntake('receive',{eventId:body.eventId,sender,message:command.message,kind:command.kind,language:command.language,analysis:{...analyzeSms(command.message),transport:body.transport||'sms'},receivedAt:new Date(received).toISOString(),nonce:signed.id}),201);
  }
  const match=path.match(/^phone-intake\/([a-f\d-]{36})\/action$/iu);
  if(match&&request.method==='POST'){
   if(!['acknowledge','called','close','callback'].includes(body.action))fail('Choose a supported phone-request action.');
   if(body.action==='close'&&(typeof body.outcome!=='string'||body.outcome.trim().length<5||body.outcome.length>1600))fail('Record the outcome before closing this request.');
   return reply(await db.phoneIntake(body.action,{id:match[1],outcome:body.action==='close'?body.outcome.trim():undefined}));
  }
  return reply({error:'This phone support action is not supported.'},405);
 }catch(error){return reply({error:error.status?error.message:'The phone request could not be processed.'},error.status||500);}
}
