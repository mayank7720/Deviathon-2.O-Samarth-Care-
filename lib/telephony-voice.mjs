import {verifyTwilioSignature,sha256,checkinTwiml,advanceCallAnswer} from './telephony.mjs';
const check=(ok,status,message)=>{if(!ok)throw Object.assign(new Error(message),{status});};
export function createVoiceCallbackHandler({loadConfig,getJob,advance,now=()=>Date.now()}) {
 return async request=>{
  try{
   const url=new URL(request.url),match=url.pathname.match(/\/(checkin|status)\/([a-f\d-]{36})\/([a-f\d]{64})$/i);
   check(match&&request.method==='POST',404,'Call callback not found.');
   const env=await loadConfig();check(env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',503,'Credited calling is not connected.');
   const job=await getJob(match[2]);check(job&&job.channel==='voice_bot',404,'Call request not found.');
   check(await sha256(match[3])===job.callbackTokenHash,401,'Invalid call callback credential.');
   check(Date.parse(job.createdAt)>now()-2*3600000,410,'The call callback has expired.');
   const publicUrl=new URL('/api/telephony/twilio/'+match[1]+'/'+match[2]+'/'+match[3]+url.search,job.callbackOrigin);
   const raw=await request.text(),verifiedRequest=new Request(publicUrl,{method:'POST',headers:request.headers,body:raw});
   const params=await verifyTwilioSignature(verifiedRequest,raw,env.TWILIO_AUTH_TOKEN);
   check(/^CA[a-f\d]{32}$/i.test(params.CallSid||'')&&(!job.providerId||params.CallSid===job.providerId),403,'This callback belongs to another call.');
   const stamp=new Date(now()).toISOString();
   if(match[1]==='status'){
    const states={queued:'accepted',initiated:'accepted',ringing:'ringing','in-progress':'answered',completed:'completed',busy:'failed','no-answer':'failed',canceled:'cancelled',failed:'failed'};
    check(Object.hasOwn(states,params.CallStatus),400,'Unsupported call status.');
    const terminal=['completed','failed','cancelled'].includes(job.status);
    if(!terminal)await advance(job,{...job,providerId:params.CallSid,status:states[params.CallStatus],providerStatus:params.CallStatus,externalDelivery:['in-progress','completed'].includes(params.CallStatus),humanRead:false,updatedAt:stamp});
    return new Response('{}',{headers:{'content-type':'application/json','cache-control':'no-store'}});
   }
   const state=job.voiceState||{language:job.language,step:0,answers:{}},step=Number(url.searchParams.get('step')),phase=url.searchParams.get('phase');
   check(Number.isInteger(step)&&step>=0&&step<=4&&['prompt','answer'].includes(phase),400,'Invalid call cursor.');
   if(phase==='answer'&&step===state.step&&!state.complete){
    const next=advanceCallAnswer(state,params.Digits);
    const result=await advance(job,{...job,providerId:params.CallSid,voiceState:next,botCompleted:next.complete===true,status:job.status==='completed'?'completed':'answered',externalDelivery:true,updatedAt:stamp},next.complete?{seniorId:job.seniorId,date:job.asOfDate,note:next.note,mood:next.mood,helpRequested:next.helpRequested,source:'credited-hindi-call'}:null);
    check(result!==false,409,'This answer was already applied.');Object.assign(state,next);
   }else check(step<=state.step,409,'The call step is ahead of the saved state.');
   const action=new URL(publicUrl);action.searchParams.set('phase','answer');action.searchParams.set('step',String(state.step));
   return new Response(checkinTwiml(state,action.href),{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store'}});
  }catch(error){const status=Number.isInteger(error.status)?error.status:500;return new Response(JSON.stringify({error:status<500?error.message:'Call processing is unavailable.'}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});}
 };
}
