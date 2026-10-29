import { buildIvrPrompt, processIvrAnswer } from './communications.mjs';

export class TelephonyError extends Error { constructor(status,message){super(message);this.status=status;this.name='TelephonyError';} }
export const checkTelephony=(condition,status,message)=>{if(!condition)throw new TelephonyError(status,message);};
const encode=new TextEncoder();
const hex=value=>[...new Uint8Array(value)].map(n=>n.toString(16).padStart(2,'0')).join('');
export const sha256=async value=>hex(await crypto.subtle.digest('SHA-256',encode.encode(value)));
export const e164=value=>typeof value==='string'&&/^\+[1-9]\d{7,14}$/.test(value);
export const maskedPhone=value=>e164(value)?`${value.slice(0,3)}••••${value.slice(-3)}`:'Not configured';
export const allowedTelephonyTemplates=role=>({senior:['checkin','followup','serious_alert'],family:['followup','serious_alert'],coordinator:['support_request','staff_alert','care_message'],operations:['escalation','care_message']}[role]||[]);
export const smsText=(template,language='en',role)=>{
  const copy={en:{support_request:'Samarth Care: A linked household has requested support. Open your secure care inbox to review and arrange contact.',staff_alert:'Samarth Care: A senior in your assigned care list needs a prompt review. Open your secure care queue.',care_message:'Samarth Care: You have a new care message in your secure inbox.',escalation:'Samarth Care: An unassigned or overdue care request needs Operations review. Open your secure care queue.',checkin:'Samarth Care: Please share a short wellbeing update with your care coordinator. This is not an emergency service.',followup:'Samarth Care: Your care team would like to arrange a call. Please contact your coordinator when convenient.',serious_alert:'Samarth Care: Please contact your care coordinator promptly for a check-in. For immediate distress, use your usual emergency support.',weekly_summary:'Samarth Care: Your reviewed weekly update is ready in the protected care inbox. Contact your coordinator if you need a call.'},hi:{support_request:'समर्थ केयर: आपके जिम्मे परिवार ने सहायता मांगी है। सुरक्षित केयर इनबॉक्स देखें।',staff_alert:'समर्थ केयर: आपके जिम्मे वरिष्ठ की शीघ्र समीक्षा जरूरी है। सुरक्षित केयर सूची देखें।',care_message:'समर्थ केयर: सुरक्षित इनबॉक्स में नया केयर संदेश है।',escalation:'समर्थ केयर: बिना जिम्मेदार या लंबित अनुरोध की ऑपरेशन्स समीक्षा जरूरी है। सुरक्षित केयर सूची देखें।',checkin:'समर्थ केयर: कृपया अपनी देखभाल टीम को आज की कुशलता बताएँ।',followup:'समर्थ केयर: कृपया कोऑर्डिनेटर से बात करने का समय तय करें।',serious_alert:'समर्थ केयर: कृपया अपनी देखभाल टीम से जल्दी संपर्क करें।',weekly_summary:'समर्थ केयर: आपकी साप्ताहिक जानकारी सुरक्षित इनबॉक्स में तैयार है।'}};
  checkTelephony(['en','hi'].includes(language)&&Object.hasOwn(copy[language],template),400,'Choose a supported language and communication template.');
  checkTelephony(!role||allowedTelephonyTemplates(role).includes(template),400,'This prompt does not match the recipient account type.');
  return copy[language][template];
};
export function telephonyContacts(env={}) {
  let value;try{value=JSON.parse(env.SAMARTH_TELEPHONY_CONTACTS_JSON||'[]');}catch{throw new TelephonyError(503,'The telephone contact configuration is invalid.');}
  checkTelephony(Array.isArray(value)&&value.length<=2000,503,'The account contact collection exceeds its supported size.');
  const ids=new Set();
  return value.map(contact=>{
    checkTelephony(contact&&/^[A-Za-z0-9_-]{1,64}$/.test(contact.id||'')&&!ids.has(contact.id)&&/^S\d{3,6}$/.test(contact.seniorId||'')&&['senior','family','coordinator','operations'].includes(contact.role)&&e164(contact.phone),503,'An approved telephone contact is invalid.');ids.add(contact.id);
    return {id:contact.id,seniorId:contact.seniorId,role:contact.role,phone:contact.phone,userId:contact.userId||null,name:contact.name||contact.role,revision:contact.revision??null,verified:contact.verified===true,smsConsent:contact.smsConsent===true,callConsent:contact.callConsent===true};
  });
}
export function assertContactConsent(contact,senior,channel) {
  checkTelephony(contact?.verified===true,409,'The destination has not been verified for showcase delivery.');
  checkTelephony(contact.seniorId===senior.id,403,'The telephone contact belongs to another care assignment.');
  checkTelephony(channel==='sms'?contact.smsConsent:contact.callConsent,403,'Consent for this communication channel is not enabled.');
  checkTelephony(contact.role!=='family'||senior.familyConsent===true,403,'Family sharing consent is not enabled.');
}
export function publicTelephonyJob(job) {
  const {leaseHash,phone,leaseToken,callbackTokenHash,callbackOrigin,...safe}=job;void leaseHash;void phone;void leaseToken;void callbackTokenHash;void callbackOrigin;
  return safe;
}
export async function signBridgeRequest({method,path,body='',secret,timestamp=Math.floor(Date.now()/1000),nonce=crypto.randomUUID()}) {
  checkTelephony(typeof secret==='string'&&secret.length>=32&&secret.length<=256,503,'The Android bridge credential is not configured.');
  const key=await crypto.subtle.importKey('raw',encode.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=hex(await crypto.subtle.sign('HMAC',key,encode.encode(`${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${body}`)));
  return {'x-samarth-bridge-timestamp':String(timestamp),'x-samarth-bridge-nonce':nonce,'x-samarth-bridge-signature':signature};
}
export async function verifyBridgeRequest(request,body,env={},now=Date.now()) {
  const secret=env.SAMARTH_ANDROID_BRIDGE_SECRET;
  checkTelephony(typeof secret==='string'&&secret.length>=32&&secret.length<=256,503,'The Android bridge credential is not configured.');
  const stamp=request.headers.get('x-samarth-bridge-timestamp')||'',nonce=request.headers.get('x-samarth-bridge-nonce')||'',signature=request.headers.get('x-samarth-bridge-signature')||'';
  checkTelephony(/^\d{10}$/.test(stamp)&&/^[A-Za-z0-9_-]{16,96}$/.test(nonce)&&/^[a-f0-9]{64}$/i.test(signature)&&Math.abs(now-Number(stamp)*1000)<=300000,401,'The Android bridge signature is invalid or expired.');
  const url=new URL(request.url);
  checkTelephony(!url.search,400,'Signed Android bridge endpoints do not accept query parameters.');
  const expected=await signBridgeRequest({method:request.method,path:url.pathname,body,secret,timestamp:Number(stamp),nonce});
  const expectedBytes=Uint8Array.from(expected['x-samarth-bridge-signature'].match(/../g),p=>parseInt(p,16));
  const actualBytes=Uint8Array.from(signature.match(/../g),p=>parseInt(p,16));
  let diff=0;for(let i=0;i<expectedBytes.length;i++)diff|=expectedBytes[i]^actualBytes[i];
  checkTelephony(diff===0,401,'The Android bridge signature is invalid or expired.');
  return {nonce,id:`telephony-nonce:${await sha256(nonce)}`};
}

function androidConfiguration(env={}) {
  let url;try{url=new URL(env.SAMARTH_ANDROID_GATEWAY_URL||'http://127.0.0.1:8080');}catch{throw new TelephonyError(503,'The local SMS gateway URL is invalid.');}
  checkTelephony(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/',503,'The Android relay only connects to a loopback SMS gateway. Use USB port forwarding or a local trusted proxy.');
  checkTelephony(typeof env.SAMARTH_ANDROID_GATEWAY_USERNAME==='string'&&env.SAMARTH_ANDROID_GATEWAY_USERNAME.length&&typeof env.SAMARTH_ANDROID_GATEWAY_PASSWORD==='string'&&env.SAMARTH_ANDROID_GATEWAY_PASSWORD.length,503,'Configure the local SMS gateway credentials.');
  const slot=env.SAMARTH_ANDROID_SIM_SLOT;
  checkTelephony(slot===undefined||slot==='1'||slot==='2',503,'Set the Android SIM slot to 1 or 2, or omit it to use the phone preference.');
  return {origin:url.origin,authorization:`Basic ${btoa(`${env.SAMARTH_ANDROID_GATEWAY_USERNAME}:${env.SAMARTH_ANDROID_GATEWAY_PASSWORD}`)}`,simNumber:slot===undefined?undefined:Number(slot)};
}
export async function androidSmsRequest(job,env={}, {fetchImpl=fetch}={}) {
  const config=androidConfiguration(env);
  checkTelephony(job.channel==='sms'&&e164(job.phone)&&/^[a-f0-9-]{36}$/.test(job.id),400,'Invalid assigned SMS job.');
  checkTelephony(typeof job.text==='string'&&job.text.length>0&&job.text.length<=(/[^\x00-\x7f]/.test(job.text)?70:160),400,'Use one bounded SMS segment.');
  const options={headers:{Authorization:config.authorization,'content-type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)};
  // Read before enqueue: a retry after a lost response must not send again.
  const existing=await fetchImpl(`${config.origin}/message/${encodeURIComponent(job.id)}`,{...options,method:'GET'});
  if(existing.ok)return {provider:'android_sms_gate',...normalizeAndroidState(await existing.json(),job.id)};
  checkTelephony(existing.status===404,503,'Could not inspect the Android SMS queue.');
  const response=await fetchImpl(`${config.origin}/message`,{...options,method:'POST',body:JSON.stringify({id:job.id,textMessage:{text:job.text},phoneNumbers:[job.phone],...(config.simNumber===undefined?{}:{simNumber:config.simNumber}),withDeliveryReport:true,ttl:1800})});
  checkTelephony(response.ok,503,'The Android SMS gateway did not accept the message.');
  return {provider:'android_sms_gate',...normalizeAndroidState(await response.json(),job.id)};
}
export async function probeAndroidGateway(env={}, {fetchImpl=fetch}={}) {
  const config=androidConfiguration(env);
  const response=await fetchImpl(`${config.origin}/message/00000000-0000-0000-0000-000000000000`,{method:'GET',headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(10000)});
  checkTelephony(response.ok||response.status===404,503,'The local Android gateway is unavailable or its credentials were rejected.');
  return {ready:true};
}
export function normalizeAndroidState(data,expectedId) {
  checkTelephony(data&&data.id===expectedId,502,'The Android gateway returned a mismatched message identifier.');
  const statuses={Pending:'accepted',Processed:'accepted',Sending:'accepted',Sent:'sent',Delivered:'delivered',Failed:'failed',Cancelled:'cancelled',Cancelling:'accepted'};
  const status=statuses[data.state];checkTelephony(status,502,'The Android gateway returned an unsupported delivery state.');
  return {providerId:data.id,status,externalDelivery:['sent','delivered'].includes(status),deliveredToHandset:status==='delivered',humanRead:false};
}
export async function androidSmsStatus(job,env={}, {fetchImpl=fetch}={}) {
  const config=androidConfiguration(env);
  const response=await fetchImpl(`${config.origin}/message/${encodeURIComponent(job.id)}`,{method:'GET',headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(12000)});
  checkTelephony(response.ok,503,'The Android SMS delivery state is temporarily unavailable.');
  return {provider:'android_sms_gate',...normalizeAndroidState(await response.json(),job.id)};
}

const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function checkinTwiml(state,actionUrl) {
  const url=new URL(actionUrl);checkTelephony(url.protocol==='https:'&&!url.username&&!url.password,400,'The voice callback must use HTTPS.');
  const prompt=buildIvrPrompt(state),language=state.language==='hi'?'hi-IN':'en-IN',voice=state.language==='hi'?'Google.hi-IN-Standard-C':'Google.en-IN-Standard-E';
  if(prompt.complete)return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${voice}" language="${language}">${xml(state.language==='hi'?'धन्यवाद। आपका जवाब देखभाल टीम को मिल गया है।':'Thank you. Your answers have been saved for the care team.')}</Say><Hangup/></Response>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="12" action="${xml(url.href)}" method="POST"><Say voice="${voice}" language="${language}">${xml(prompt.prompt)}</Say></Gather><Say voice="${voice}" language="${language}">${xml(state.language==='hi'?'जवाब नहीं मिला। कृपया अपनी देखभाल टीम से संपर्क करें।':'No answer was received. Please contact your care team.')}</Say><Hangup/></Response>`;
}
export function advanceCallAnswer(state,digit){return processIvrAnswer(state,digit);}
export async function verifyTwilioSignature(request,raw,authToken) {
  checkTelephony(typeof authToken==='string'&&authToken.length>=16,503,'The voice provider is not configured.');
  checkTelephony(request.headers.get('content-type')?.includes('application/x-www-form-urlencoded'),415,'Voice callbacks must use form encoding.');
  const url=new URL(request.url);checkTelephony(url.protocol==='https:',400,'Voice callbacks require HTTPS.');
  const params=new URLSearchParams(raw);checkTelephony([...params.keys()].length<=40&&raw.length<=12000,413,'Voice callback is too large.');
  const signature=request.headers.get('x-twilio-signature')||'';
  let message=url.href;for(const name of [...new Set(params.keys())].sort())for(const value of [...new Set(params.getAll(name))].sort())message+=name+value;
  const key=await crypto.subtle.importKey('raw',encode.encode(authToken),{name:'HMAC',hash:'SHA-1'},false,['verify']);
  let bytes;try{bytes=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));}catch{throw new TelephonyError(401,'The voice provider signature is invalid.');}
  checkTelephony(await crypto.subtle.verify('HMAC',key,bytes,encode.encode(message)),401,'The voice provider signature is invalid.');
  return Object.fromEntries(params);
}
export async function startTrialVoiceCall(job,env={}, {fetchImpl=fetch}={}) {
  checkTelephony(env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',503,'Credited telephone calling is not enabled.');
  checkTelephony(/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')&&typeof env.TWILIO_AUTH_TOKEN==='string'&&env.TWILIO_AUTH_TOKEN.length>=16&&e164(env.TWILIO_FROM_NUMBER)&&e164(job.phone),503,'The trial telephone provider is not configured.');
  const auth=`Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
  const accountUrl=`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;
  const account=await fetchImpl(accountUrl+'.json',{headers:{Authorization:auth},redirect:'manual',signal:AbortSignal.timeout(12000)});
  checkTelephony(account.ok,503,'The telephone account could not be verified.');
  checkTelephony((await account.json()).type==='Trial',409,'This adapter only permits a trial account; paid-account calls are disabled.');
  checkTelephony(job.channel==='voice_bot'&&job.callbackUrl&&job.statusCallbackUrl,400,'Configure the protected call-answer and status callbacks.');
  for(const value of [job.callbackUrl,job.statusCallbackUrl]){const u=new URL(value);checkTelephony(u.protocol==='https:'&&!u.username&&!u.password,400,'Call callbacks require HTTPS.');}
  const form=new URLSearchParams({To:job.phone,From:env.TWILIO_FROM_NUMBER,Url:job.callbackUrl,Method:'POST',StatusCallback:job.statusCallbackUrl,StatusCallbackMethod:'POST',Timeout:'25'});
  form.append('StatusCallbackEvent','initiated');form.append('StatusCallbackEvent','ringing');form.append('StatusCallbackEvent','answered');form.append('StatusCallbackEvent','completed');
  const response=await fetchImpl(accountUrl+'/Calls.json',{method:'POST',headers:{Authorization:auth,'content-type':'application/x-www-form-urlencoded'},body:form.toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});
  checkTelephony(response.ok,503,'The trial telephone provider did not accept the call.');
  const data=await response.json();checkTelephony(/^CA[a-f0-9]{32}$/i.test(data.sid||''),502,'The voice provider returned an invalid call identifier.');
  return {provider:'twilio_trial',providerId:data.sid,status:'accepted',externalDelivery:false,deliveryNotice:'The provider accepted the request. Ringing, answer and outcome require signed provider callbacks.'};
}
