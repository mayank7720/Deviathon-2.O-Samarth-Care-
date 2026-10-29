import {canManageCare} from './access.mjs';
import {speechCheck as check,speechUuid,speechConfiguration,createSpeechTicket,verifySpeechReceipt,SPEECH_LIMITS} from './speech.mjs';
import {scanEvents} from './workflow-store.mjs';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const json=row=>typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
const visible=(session,id)=>session.scope?.includes('*')||session.scope?.includes(id);
const conflict=error=>error.status===409||/UNIQUE constraint|23505/i.test(String(error.message));
function draftView(row,review){const p=json(row),r=review?json(review):null;return {id:p.transcription.ticketId,seniorId:row.senior_id,status:r?(r.action==='approve'?'approved':'rejected'):'awaiting_review',text:p.transcription.text,editedText:r?.editedText,model:p.transcription.model,language:p.transcription.language,durationSeconds:p.transcription.durationSeconds,segments:p.transcription.segments,createdAt:row.created_at,review:r?{action:r.action,editedText:r.editedText,note:r.note,createdAt:review.created_at}:null,externalServiceUsed:false};}
export async function handleSpeechRoute({path,request,body={},db,context,cohort,getSenior,event,asOfDate,onMutation,now=Date.now(),env={}}){
 if(path!=='speech'&&!path.startsWith('speech/'))return null;
 try{
  const {session,owner}=context;
  check(context.authenticated&&context.authorized&&session,401,'Sign in to an assigned care workspace.');
  check(['coordinator','operations'].includes(session.role),403,'Transcription notes are available only to the assigned care team.');
  if(!['GET','HEAD'].includes(request.method)){
   check(canManageCare(session),403,'Only a coordinator can record or review speech notes.');
   speechConfiguration(env);
  }
  const actorId=context.userId||session.userId,origin=new URL(request.url).origin;
  if(path==='speech/status'&&request.method==='GET'){
   let configured=false;try{speechConfiguration(env);configured=true;}catch{/* No secret reaches clients. */}
   return reply({configured,serviceUrl:'http://127.0.0.1:8766',limits:SPEECH_LIMITS,privacy:'Audio is processed by your paired laptop. Only a signed transcript draft is stored in the private care workspace. A coordinator reviews the words before they become a health signal.'});
  }
  if(path==='speech/ticket'&&request.method==='POST'){
   check(canManageCare(session),403,'Only a coordinator can request local transcription.');
   check(body.consentConfirmed===true,400,'Confirm permission to record and transcribe this audio.');
   check(visible(session,body.seniorId),403,'This senior is outside your care assignment.');await getSenior(body.seniorId);
   return reply(await createSpeechTicket({seniorId:body.seniorId,actorId,origin,now},env));
  }
  const seniorIds=cohort.seniors.filter(s=>visible(session,s.id)).map(s=>s.id);
  const rows=await scanEvents(db,{owner,seniorIds,kinds:['speech_draft','speech_review'],limit:5000});
  check(rows.length<5000,503,'The transcript history reached its safe scan limit. No records were reset; ask the administrator to extend the history reader.');
  if(path==='speech/drafts'&&request.method==='GET'){
   const id=new URL(request.url).searchParams.get('seniorId');if(id){check(visible(session,id),403,'This senior is outside your care assignment.');await getSenior(id);}
   const drafts=rows.filter(r=>r.kind==='speech_draft'&&(!id||r.senior_id===id)).map(row=>draftView(row,rows.find(r=>r.id==='speech-review:'+json(row).transcription.ticketId&&r.kind==='speech_review'))).reverse();
   return reply({drafts});
  }
  check(canManageCare(session),403,'Only a coordinator can record or review speech notes.');
  if(path==='speech/drafts'&&request.method==='POST'){
   check(body.consentConfirmed===true,400,'Confirm permission to store this transcript.');
   const transcription=await verifySpeechReceipt(body.receipt,env,{actorId,origin,now});
   check(visible(session,transcription.seniorId),403,'This senior is outside your care assignment.');await getSenior(transcription.seniorId);
   const id='speech-draft:'+transcription.ticketId,existing=rows.find(r=>r.id===id&&r.kind==='speech_draft');
   if(existing){check(json(existing).receipt.payload===body.receipt.payload,409,'This ticket belongs to another audio receipt.');return reply({draft:draftView(existing,rows.find(r=>r.id==='speech-review:'+transcription.ticketId)),repeated:true});}
   const payload={transcription,receipt:body.receipt,consentConfirmed:true,actorId,status:'awaiting_review'};
   try{await db.batch([event(db,owner,'speech_draft',transcription.seniorId,payload,id),event(db,owner,'audit',transcription.seniorId,{action:'speech_draft',actor:session.name,detail:'Consented local transcription saved for human review; no audio uploaded.'})]);}catch(error){if(conflict(error))return reply({error:'This transcript was already saved. Refresh the draft list.'},409);throw error;}
   return reply({draft:{id:transcription.ticketId,seniorId:transcription.seniorId,status:'awaiting_review',...transcription,createdAt:new Date(now).toISOString()},notice:'Saved for review. The draft has not changed risk scoring.'},201);
  }
  const match=path.match(/^speech\/drafts\/([a-f\d-]{36})\/review$/i);
  if(match&&request.method==='POST'){
   check(speechUuid(match[1]),400,'Choose a valid transcript draft.');
   const row=rows.find(r=>r.id==='speech-draft:'+match[1]&&r.kind==='speech_draft');check(row,404,'Transcript draft not found in your care assignment.');
   await getSenior(row.senior_id);check(!rows.some(r=>r.id==='speech-review:'+match[1]),409,'This transcript has already been reviewed.');
   check(['approve','reject'].includes(body.action),400,'Approve the checked words or reject the transcript.');
   check(body.note===undefined||typeof body.note==='string'&&body.note.length<=1600,400,'Keep the review note within 1,600 characters.');
   check(body.action!=='approve'||typeof body.editedText==='string'&&body.editedText.trim().length>0&&body.editedText.length<=SPEECH_LIMITS.maxText,400,'Check and enter the transcript before approving it.');
   const original=json(row).transcription,review={ticketId:match[1],action:body.action,editedText:body.action==='approve'?body.editedText.trim():'',note:body.note||'',actorId,originalAudioSha256:original.audioSha256,createdAt:new Date(now).toISOString()};
   const statements=[event(db,owner,'speech_review',row.senior_id,review,'speech-review:'+match[1]),event(db,owner,'audit',row.senior_id,{action:'speech_review',actor:session.name,detail:body.action==='approve'?'Coordinator checked and approved a local transcript.':'Coordinator rejected a local transcript.'})];
   if(body.action==='approve')statements.push(event(db,owner,'signal',row.senior_id,{type:'note',record:{seniorId:row.senior_id,date:asOfDate,note:review.editedText,source:'local-whisper-reviewed',transcription:{ticketId:match[1],model:original.model,audioSha256:original.audioSha256,reviewedBy:actorId}}},'speech-signal:'+match[1]));
   try{await db.batch(statements);}catch(error){if(conflict(error))return reply({error:'This transcript was already reviewed. Refresh before retrying.'},409);throw error;}
   if(body.action==='approve')await onMutation?.();
   return reply({ok:true,status:body.action==='approve'?'approved':'rejected',signalRecorded:body.action==='approve'});
  }
  return reply({error:'Unsupported speech action.'},405);
 }catch(error){return reply({error:error.status?error.message:'The transcription record could not be completed.'},error.status||500);}
}
