import { buildIvrPrompt, processIvrAnswer } from './communications.mjs';

/** A signed ingestion boundary for an operator or self-hosted telephone bridge.
 * It never dials a number and never trusts a browser-supplied role or user ID.
 */
export class PhoneGatewayError extends Error {
  constructor(status, message) { super(message); this.status=status; this.name='PhoneGatewayError'; }
}
const check=(condition,status,message)=>{if(!condition)throw new PhoneGatewayError(status,message);};
const encoder=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

/**
 * Verify the exact UTF-8 JSON body, then derive one bounded clinical note.
 * The caller MUST atomically insert eventId once in durable storage before
 * responding successfully. Validation alone is not replay protection.
 */
export async function validatePhoneEvent(request, raw, env={}, {now=Date.now()}={}) {
  const secret=env.SAMARTH_PHONE_GATEWAY_SECRET;
  check(typeof secret==='string'&&secret.length>=32&&secret.length<=256,503,'The phone gateway is not configured.');
  const allowed=String(env.SAMARTH_PHONE_SENIORS||'').split(',').map(value=>value.trim()).filter(value=>/^S\d{3,6}$/.test(value));
  check(allowed.length>0,503,'No senior assignments have been configured for this phone gateway.');
  check(request.method==='POST',405,'Phone events require POST.');
  check(request.headers.get('content-type')?.includes('application/json'),415,'Phone events require application/json.');
  const url=new URL(request.url);
  check(url.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname),400,'The phone gateway requires HTTPS outside loopback.');
  check(typeof raw==='string'&&encoder.encode(raw).byteLength<=8000,413,'The phone event is too large.');
  const timestamp=request.headers.get('x-samarth-timestamp')||'';
  const nonce=request.headers.get('x-samarth-nonce')||'';
  const signature=request.headers.get('x-samarth-signature')||'';
  check(/^\d{10}$/.test(timestamp)&&/^[A-Za-z0-9_-]{16,96}$/.test(nonce)&&/^[a-fA-F0-9]{64}$/.test(signature),401,'The phone gateway signature is invalid.');
  check(Number.isFinite(now)&&Math.abs(now-Number(timestamp)*1000)<=300000,401,'The phone event has expired.');
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g),part=>parseInt(part,16));
  const valid=await crypto.subtle.verify('HMAC',key,bytes,encoder.encode(`${timestamp}\n${nonce}\n${raw}`));
  check(valid,401,'The phone gateway signature is invalid.');
  let input;try{input=JSON.parse(raw);}catch{throw new PhoneGatewayError(400,'The phone event contains invalid JSON.');}
  check(input&&typeof input==='object'&&!Array.isArray(input),400,'Provide a phone event object.');
  const fields=new Set(['version','callId','seniorId','language','answers','observedDate']);
  check(Object.keys(input).every(field=>fields.has(field)),400,'The phone event contains unsupported fields.');
  check(input.version===1,400,'Use phone-event version 1.');
  check(typeof input.callId==='string'&&/^[A-Za-z0-9_-]{8,96}$/.test(input.callId),400,'Provide an opaque call ID without contact information.');
  check(allowed.includes(input.seniorId),403,'This senior is outside the phone gateway assignment.');
  check(['en','hi'].includes(input.language),400,'Choose English or Hindi.');
  check(dateValid(input.observedDate),400,'Provide the valid date on which the check-in occurred.');
  check(input.answers&&typeof input.answers==='object'&&!Array.isArray(input.answers)&&Object.keys(input.answers).length===4,400,'Provide exactly four structured check-in answers.');
  let state={language:input.language,step:0,answers:{}},result;
  for(let index=0;index<4;index++) {
    const prompt=buildIvrPrompt(state);
    const value=input.answers[prompt.questionId];
    const option=prompt.options.find(option=>option.value===value);
    check(option,400,'A phone check-in answer is invalid or incomplete.');
    result=processIvrAnswer(state,option.digit);state=result.state;
  }
  const eventId=`phone:${hex(await crypto.subtle.digest('SHA-256',encoder.encode(nonce)))}`;
  const callEventId=`phone-call:${hex(await crypto.subtle.digest('SHA-256',encoder.encode(input.callId)))}`;
  const record={seniorId:input.seniorId,date:input.observedDate,source:'phone-gateway',note:result.note,mood:result.mood,helpRequested:result.helpRequested};
  return {eventId,callEventId,seniorId:input.seniorId,record,callId:input.callId,timestamp:Number(timestamp),nonce,payload:{type:'note',record,language:input.language,answers:state.answers,mood:result.mood,helpRequested:result.helpRequested,callRequested:result.callRequested,requiresHumanReview:result.requiresHumanReview,source:'phone-gateway',callId:input.callId,externalDelivery:false,deliveryNotice:'A trusted gateway submitted these answers. Samarth Care did not place this telephone call.'}};
}
