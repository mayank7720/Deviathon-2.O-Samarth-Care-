/** Small, explicit SMS questionnaire. Codes identify a question, never an account. */
import {verifyBridgeRequest} from './telephony.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function checkinReply(value){
 if(typeof value!=='string'||value.length>80)return null;
 const text=value.normalize('NFKC').replace(/[१२३]/gu,c=>({'१':'1','२':'2','३':'3'})[c]).trim().toUpperCase();
 if(/^(STOP|UNSUBSCRIBE|बंद)$/u.test(text))return {kind:'checkin',message:text,language:text==='बंद'?'hi':'en',choice:'stop',code:null};
 const match=text.match(/^(?:([A-F0-9]{6})[\s:#-]+([123])|([123])[\s:#-]+([A-F0-9]{6})|([123]))[.!।]?$/u);
 return match?{kind:'checkin',message:text,language:'en',choice:match[2]||match[3]||match[5],code:match[1]||match[4]||null}:null;
}
export async function handleSmsCheckinRoute({path,request,body={},rawBody,db,context,env={},now=Date.now()}){
 if(!path.startsWith('sms-checkins'))return null;
 const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 try{
  if(!context?.authenticated||!context?.authorized||!context.session?.userId)fail('Sign in to your care account.',401);
  if(!['coordinator','operations'].includes(context.session.role))fail('SMS check-ins are managed by the assigned care team.',403);
  if(typeof db.smsCheckins!=='function')fail('SMS check-ins need the cloud care database.',503);
  if(path==='sms-checkins'&&request.method==='GET')return reply(await db.smsCheckins('list',{}));
  if(request.method!=='POST'||!body||Array.isArray(body))fail('Use a supported check-in action.',405);
  if(path==='sms-checkins'){
   if(Object.keys(body).some(k=>!['seniorId','language','sendAt','windowHours','consentConfirmed','idempotencyKey'].includes(k)))fail('Choose an assigned senior; the saved account determines the recipient.');
   if(!/^S\d{3,6}$/.test(body.seniorId||'')||!['en','hi'].includes(body.language)||![2,4,8,24].includes(body.windowHours)||body.consentConfirmed!==true||!/^[A-Za-z0-9_-]{16,80}$/.test(body.idempotencyKey||''))fail('Choose a senior, language, response window and confirm SMS permission.');
   const send=Date.parse(body.sendAt);
   if(!Number.isFinite(send)||send<now-60000||send>now+7*86400000)fail('Choose a send time within the next seven days.');
   return reply(await db.smsCheckins('create',body),201);
  }
  const bridge=path.match(/^sms-checkins\/bridge\/(outbound|claim|receipt|eligible)$/u);
  if(bridge){
   if(env.SAMARTH_PHONE_INTAKE_ENABLED!=='true')fail('The phone relay is not enabled.',503);
   const proof=await verifyBridgeRequest(request,rawBody??JSON.stringify(body),env,now);
   const allowed=bridge[1]==='outbound'?[]:bridge[1]==='eligible'?['senderHash']:bridge[1]==='claim'?['id']:['id','leaseToken','status','providerId'];
   if(Object.keys(body).some(k=>!allowed.includes(k)))fail('Unsupported relay fields.');
   if(bridge[1]==='eligible'&&!/^[a-f\d]{64}$/u.test(body.senderHash||''))fail('Use a masked sender lookup.');
   if(['claim','receipt'].includes(bridge[1])&&!/^[a-f\d-]{36}$/iu.test(body.id||''))fail('Choose a saved check-in.');
   if(bridge[1]==='receipt'&&(!/^[a-f\d-]{36}$/iu.test(body.leaseToken||'')||body.providerId!==body.id||!['accepted','sent','delivered','failed','cancelled'].includes(body.status)))fail('Use a receipt for the assigned message.');
   return reply(await db.smsCheckins(bridge[1],{...body,nonce:proof.id}));
  }
  const action=path.match(/^sms-checkins\/([a-f\d-]{36})\/(cancel|review|review-reply)$/iu);
  if(action){
   if(Object.keys(body).some(k=>k!=='outcome'))fail('Unsupported review fields.');
   if(action[2]!=='cancel'&&(typeof body.outcome!=='string'||body.outcome.trim().length<5||body.outcome.length>1600))fail('Record the human review outcome.');
   return reply(await db.smsCheckins(action[2],{id:action[1],outcome:body.outcome?.trim()}));
  }
  fail('Use a supported check-in action.',405);
 }catch(error){return reply({error:error.status?error.message:'The SMS check-in could not be saved.'},error.status||500);}
}
