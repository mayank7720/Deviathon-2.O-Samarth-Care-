/** Speech capabilities bind local inference to a verified coordinator and one senior. */
export class SpeechError extends Error{constructor(status,message){super(message);this.status=status;}}
export const speechCheck=(ok,status,message)=>{if(!ok)throw new SpeechError(status,message);};
export const SPEECH_LIMITS=Object.freeze({maxBytes:8*1024*1024,maxSeconds:180,maxText:6000});
const encoder=new TextEncoder(),hex=bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
export const speechUuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
export function speechConfiguration(env={}){
 const secret=env.SAMARTH_SPEECH_SECRET;
 speechCheck(typeof secret==='string'&&secret.length>=32&&secret.length<=256,503,'The local transcription pairing is not configured.');
 const serviceUrl=env.SAMARTH_SPEECH_SERVICE_URL||'http://127.0.0.1:8766';
 speechCheck(serviceUrl==='http://127.0.0.1:8766',503,'The transcription service must use the paired loopback endpoint.');
 return {secret,serviceUrl};
}
export async function speechSignature(message,secret){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(message)));
}
async function verifySignature(message,signature,secret){
 if(typeof signature!=='string'||!/^[a-f\d]{64}$/i.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),b=>parseInt(b,16)),encoder.encode(message));
}
export async function createSpeechTicket({seniorId,actorId,origin,now=Date.now()},env={}){
 const {secret,serviceUrl}=speechConfiguration(env);
 speechCheck(/^S\d{3,6}$/.test(seniorId)&&typeof actorId==='string'&&actorId.length<=100,400,'The transcription needs a valid senior and coordinator identity.');
 const payload={version:1,id:crypto.randomUUID(),seniorId,actorId,origin,issuedAt:now,expiresAt:now+300000,consent:true};
 const encoded=btoa(String.fromCharCode(...encoder.encode(JSON.stringify(payload)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const signature=await speechSignature('speech-ticket\n'+encoded,secret);
 return {ticket:encoded+'.'+signature,serviceUrl,ticketId:payload.id,expiresAt:payload.expiresAt};
}
export async function verifySpeechReceipt(receipt,env={}, {actorId,origin,now=Date.now()}={}){
 const {secret}=speechConfiguration(env);
 speechCheck(receipt&&typeof receipt.payload==='string'&&encoder.encode(receipt.payload).length<=96000,400,'The speech receipt is invalid or too large.');
 speechCheck(await verifySignature('speech-receipt\n'+receipt.payload,receipt.signature,secret),401,'The transcription receipt is not from the paired local service.');
 let value;try{value=JSON.parse(receipt.payload);}catch{throw new SpeechError(400,'The transcription receipt is not valid JSON.');}
 speechCheck(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['version','ticketId','seniorId','actorId','origin','model','language','languageProbability','durationSeconds','audioSha256','text','segments','createdAt','expiresAt','externalServiceUsed'].includes(k)),400,'The transcription receipt contains unsupported fields.');
 speechCheck(value&&value.version===1&&speechUuid(value.ticketId)&&/^S\d{3,6}$/.test(value.seniorId),400,'The transcription receipt has an invalid identity.');
 speechCheck(value.actorId===actorId&&value.origin===origin,403,'This transcription belongs to a different coordinator or application origin.');
 speechCheck(Number.isFinite(value.createdAt)&&Number.isFinite(value.expiresAt)&&value.createdAt<=now+30000&&value.expiresAt>now&&value.expiresAt<=value.createdAt+86400000,410,'The transcription receipt has expired or has invalid timestamps.');
 speechCheck(/^faster-whisper:(base|small)$/.test(value.model)&&value.externalServiceUsed===false,400,'The receipt does not identify a supported local speech model.');
 speechCheck(typeof value.text==='string'&&value.text.trim().length>0&&value.text.length<=SPEECH_LIMITS.maxText,400,'The transcription is empty or too long.');
 speechCheck(Number.isFinite(value.durationSeconds)&&value.durationSeconds>0&&value.durationSeconds<=SPEECH_LIMITS.maxSeconds,400,'The audio duration is outside the recording limit.');
 speechCheck(/^[a-f\d]{64}$/.test(value.audioSha256||'')&&typeof value.language==='string'&&/^[a-z]{2,3}$/.test(value.language),400,'The speech provenance is incomplete.');
 speechCheck(Array.isArray(value.segments)&&value.segments.length<=120&&value.segments.every(s=>s&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>=s.start&&s.end<=value.durationSeconds+1&&typeof s.text==='string'&&s.text.length<=6000),400,'The speech segments are invalid.');
 speechCheck(value.languageProbability===undefined||Number.isFinite(value.languageProbability)&&value.languageProbability>=0&&value.languageProbability<=1,400,'The language confidence is invalid.');
 return value;
}
