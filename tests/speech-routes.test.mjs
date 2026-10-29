import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {handleSpeechRoute} from '../lib/speech-routes.mjs';
import {speechSignature} from '../lib/speech.mjs';

const now=Date.parse('2026-10-29T09:00:00Z');
const origin='http://localhost:5173';
const configured={SAMARTH_SPEECH_SECRET:'fixture-only-speech-secret-not-used-in-production'};
const ticketId='661522b7-d018-448b-9ac8-899015e48eda';
const cohort={seniors:[{id:'S001',name:'Fictional senior'},{id:'S002',name:'Second fictional senior'}]};
function fixture(){
 const db=new LocalD1();let mutations=0;
 const event=(store,owner,kind,seniorId,payload,id=crypto.randomUUID())=>store.prepare('INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind(id,owner,kind,seniorId,JSON.stringify(payload),new Date(now).toISOString());
 const call=async(path,{method='GET',body={},role='coordinator',scope=['*'],env={},store=db}={})=>{
  const context={authenticated:true,authorized:true,userId:'test-coordinator',owner:'workspace:primary',session:{role,scope,name:'Test coordinator',userId:'test-coordinator'}};
  const response=await handleSpeechRoute({path:'speech/'+path.split('?')[0],request:new Request(origin+'/api/speech/'+path,{method}),body,db:store,context,cohort,event,now,env,asOfDate:'2026-10-29',onMutation:()=>{mutations++;},getSenior:id=>{assert.ok(scope.includes('*')||scope.includes(id));return cohort.seniors.find(s=>s.id===id);}});
  return {status:response.status,data:await response.json()};
 };
 return {db,event,call,mutations:()=>mutations,close:()=>db.close()};
}
async function receipt(){
 const value={version:1,ticketId,seniorId:'S001',actorId:'test-coordinator',origin,model:'faster-whisper:base',language:'hi',languageProbability:0.8,durationSeconds:5,audioSha256:'a'.repeat(64),text:'A fictional senior requested a friendly check-in.',segments:[{start:0,end:5,text:'A fictional senior requested a friendly check-in.'}],createdAt:now,expiresAt:now+86400000,externalServiceUsed:false};
 const payload=JSON.stringify(value);
 return {payload,signature:await speechSignature('speech-receipt\n'+payload,configured.SAMARTH_SPEECH_SECRET)};
}

test('unpaired deployments reject every speech mutation before database access',async()=>{
 const f=fixture();try{
  const unavailable=new Proxy({},{get(){throw new Error('An unpaired speech mutation must not access the database.');}});
  for(const [path,body,method] of [['ticket',{seniorId:'S001',consentConfirmed:true},'POST'],['drafts',{receipt:await receipt(),consentConfirmed:true},'POST'],['drafts/'+ticketId+'/review',{action:'approve',editedText:'A checked care note.'},'POST'],['drafts/'+ticketId+'/review',{action:'reject'},'POST'],['drafts',{},'PATCH']]){
   const result=await f.call(path,{method,body,store:unavailable});assert.equal(result.status,503,JSON.stringify(result.data));assert.match(result.data.error,/not configured/i);
  }
  assert.equal(f.db.db.prepare('SELECT count(*) n FROM care_events').get().n,0);assert.equal(f.mutations(),0);
 }finally{f.close();}
});

test('read-only status is available without pairing and never exposes signing material',async()=>{
 const f=fixture();try{
  const disabled=await f.call('status');assert.equal(disabled.status,200);assert.equal(disabled.data.configured,false);
  const enabled=await f.call('status',{env:configured});assert.equal(enabled.status,200);assert.equal(enabled.data.configured,true);assert.equal(enabled.data.serviceUrl,'http://127.0.0.1:8766');assert.ok(!JSON.stringify(enabled.data).includes(configured.SAMARTH_SPEECH_SECRET));
  const invalid=await f.call('ticket',{method:'POST',env:{...configured,SAMARTH_SPEECH_SERVICE_URL:'https://outside.invalid'},body:{seniorId:'S001',consentConfirmed:true}});assert.equal(invalid.status,503);
 }finally{f.close();}
});

test('existing transcript history remains readable in an unpaired hosted deployment',async()=>{
 const f=fixture();try{
  const signed=await receipt(),transcription=JSON.parse(signed.payload);
  await f.event(f.db,'workspace:primary','speech_draft','S001',{transcription,receipt:signed,consentConfirmed:true,actorId:'test-coordinator',status:'awaiting_review'},'speech-draft:'+ticketId).run();
  for(const role of ['coordinator','operations']){
   const listed=await f.call('drafts?seniorId=S001',{role});assert.equal(listed.status,200);assert.equal(listed.data.drafts.length,1);assert.equal(listed.data.drafts[0].status,'awaiting_review');assert.equal(listed.data.drafts[0].text,transcription.text);assert.equal('receipt' in listed.data.drafts[0],false);
  }
  const hidden=await f.call('drafts',{scope:['S002']});assert.equal(hidden.status,200);assert.deepEqual(hidden.data.drafts,[]);
 }finally{f.close();}
});

test('role restrictions remain authoritative before pairing availability',async()=>{
 const f=fixture();try{
  for(const role of ['family','senior'])for(const method of ['GET','POST']){
   const result=await f.call('drafts',{role,method});assert.equal(result.status,403);
  }
  const operations=await f.call('drafts/'+ticketId+'/review',{role:'operations',method:'POST',body:{action:'approve',editedText:'Unauthorized review.'}});assert.equal(operations.status,403);
 }finally{f.close();}
});

test('configured local transcription still requires a signed draft and explicit human approval',async()=>{
 const f=fixture();try{
  const ticket=await f.call('ticket',{method:'POST',env:configured,body:{seniorId:'S001',consentConfirmed:true}});assert.equal(ticket.status,200);assert.equal(ticket.data.serviceUrl,'http://127.0.0.1:8766');
  const signed=await receipt(),bad={...signed,signature:'0'.repeat(64)};
  const refused=await f.call('drafts',{method:'POST',env:configured,body:{receipt:bad,consentConfirmed:true}});assert.equal(refused.status,401);
  const saved=await f.call('drafts',{method:'POST',env:configured,body:{receipt:signed,consentConfirmed:true}});assert.equal(saved.status,201);assert.equal(saved.data.draft.status,'awaiting_review');
  assert.equal(f.db.db.prepare("SELECT count(*) n FROM care_events WHERE kind='signal'").get().n,0);
  const review=await f.call('drafts/'+ticketId+'/review',{method:'POST',env:configured,body:{action:'approve',editedText:'The coordinator checked these words against the recording.'}});assert.equal(review.status,200);assert.equal(review.data.signalRecorded,true);assert.equal(f.mutations(),1);
  const signal=f.db.db.prepare("SELECT payload FROM care_events WHERE kind='signal'").get();assert.equal(JSON.parse(signal.payload).record.source,'local-whisper-reviewed');
  const repeat=await f.call('drafts/'+ticketId+'/review',{method:'POST',env:configured,body:{action:'approve',editedText:'A second review must fail.'}});assert.equal(repeat.status,409);
 }finally{f.close();}
});
