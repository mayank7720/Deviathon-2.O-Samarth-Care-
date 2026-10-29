import {canManageCare} from './access.mjs';
import {TelephonyError,checkTelephony as check,telephonyContacts,assertContactConsent,sha256,verifyBridgeRequest} from './telephony.mjs';
import {scanEvents} from './workflow-store.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const parse=row=>typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
const changed=value=>Number(value?.meta?.changes??value?.changes??0);
const conflict=error=>error.status===409||/UNIQUE constraint|23505/i.test(String(error.message));
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const lockId='sim-call-caller-lock';
const terminal=new Set(['declined','answers_recorded','disconnected','failed','submission_unknown']);
const safeJob=job=>{const {leaseHash,leaseToken,phone,...value}=job;void leaseHash;void leaseToken;void phone;return value;};
export const SIM_CALL_NOTICE='Prepared Linux/Asterisk Bluetooth bridge. A real SIM call requires verified two-way phone audio and an explicitly started local worker. No API vendor call fee; existing carrier charges and plan limits apply. Recording begins only after the recipient presses 1. CLI acceptance is not an answered call or completed human follow-up.';

export async function handleSimCallRoute({path,request,body={},rawBody,db,context,env={},cohort,getSenior,event,now=Date.now()}) {
  if(!path.startsWith('sim-calls/'))return null;
  try {
    const {session,owner}=context;
    check(context.authenticated&&context.authorized&&session,401,'Sign in to an assigned care workspace.');
    check(['coordinator','operations'].includes(session.role),403,'SIM call records are available only to the assigned care team.');
    const canView=id=>session.scope?.includes('*')||session.scope?.includes(id);
    const seniorIds=cohort?.seniors?.filter(s=>canView(s.id)).map(s=>s.id)??session.scope?.filter(id=>/^S\d{3,6}$/.test(id))??[];
    check(!session.scope?.includes('*')||cohort?.seniors,503,'The call service needs the scoped cohort reader.');
    const source=await scanEvents(db,{owner,seniorIds,kinds:['sim_call_job','sim_call_bridge','telephony_contact'],limit:5000});
    check(source.length<5000,503,'The SIM call history reached its safe scan limit. No call was retried or reset.');
    const jobs=source.filter(r=>r.kind==='sim_call_job'&&canView(r.senior_id)).map(r=>({...parse(r),id:r.id,seniorId:r.senior_id}));
    const contacts=new Map(telephonyContacts(env).map(c=>[c.id,c]));
    for(const row of source.filter(r=>r.kind==='telephony_contact')){const value=parse(row);if(value?.contact)contacts.set(value.contact.id,value.contact);}
    if(typeof db.accountContacts==='function'){contacts.clear();for(const contact of await db.accountContacts())contacts.set(contact.id,contact);}
    const validatedContacts=telephonyContacts({SAMARTH_TELEPHONY_CONTACTS_JSON:JSON.stringify([...contacts.values()])});
    const contactFor=async id=>{const contact=validatedContacts.find(c=>c.id===id);check(contact,404,'Approved contact not found.');check(canView(contact.seniorId),403,'This contact is outside your care scope.');assertContactConsent(contact,await getSenior(contact.seniorId),'call');return contact;};
    const load=async(id,kind='sim_call_job')=>{const row=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,kind).first();return row?{...parse(row),id:row.id,seniorId:row.senior_id}:null;};
    const coordinator=()=>check(canManageCare(session),403,'Only a coordinator can request or operate SIM calls.');
    const enabled=env.SAMARTH_SIM_VOICE_ENABLED==='true';
    const clock=new Date(now).toISOString();
    async function signedBridge() {
      coordinator();check(enabled,503,'The Linux SIM voice bridge is not enabled.');
      const proof=await verifyBridgeRequest(request,request.method==='GET'?'':rawBody??JSON.stringify(body),{SAMARTH_ANDROID_BRIDGE_SECRET:env.SAMARTH_SIM_BRIDGE_SECRET},now);
      const nonceId=proof.id.replace('telephony-nonce:','sim-call-nonce:');
      try{await event(db,owner,'sim_call_nonce','',{action:'bridge_request',createdAt:clock},nonceId).run();}catch(error){if(conflict(error))throw new TelephonyError(409,'This SIM bridge request has already been used.');throw error;}
    }
    const cas=(job,next,kind='sim_call_job')=>db.prepare("UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ? AND json_extract(payload, '$.state.step') = ?").bind(JSON.stringify({...next,state:{step:job.state.step+1}}),job.id,owner,kind,job.state.step);
    async function callerLock() {
      let lock=await load(lockId,'sim_call_bridge');
      if(!lock){
        try{await event(db,owner,'sim_call_bridge','',{state:{step:0},activeJobId:null,lockedUntil:null},lockId).run();}catch(error){if(!conflict(error))throw error;}
        lock=await load(lockId,'sim_call_bridge');
      }
      check(lock,503,'The shared caller lock is unavailable.');return lock;
    }
    if(path==='sim-calls/status'&&request.method==='GET') {
      const heartbeat=source.filter(r=>r.kind==='sim_call_bridge'&&r.id!==lockId).map(parse).filter(p=>p.deviceReady===true&&Number.isFinite(Date.parse(p.createdAt))&&Date.parse(p.createdAt)<=now+30000).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).at(-1);
      return reply({enabled,bridgeOnline:enabled&&!!heartbeat&&now-Date.parse(heartbeat.createdAt)<120000,lastSeenAt:heartbeat?.createdAt||null,notice:SIM_CALL_NOTICE});
    }
    if(path==='sim-calls/jobs'&&request.method==='GET')return reply({jobs:jobs.slice(-100).reverse().map(safeJob),notice:SIM_CALL_NOTICE});
    if(path==='sim-calls/jobs'&&request.method==='POST') {
      coordinator();check(enabled,503,'Prepare and verify the Linux call bridge before enabling real SIM voice requests.');
      check(body.consentConfirmed===true,400,'Confirm the destination owner agreed to receive this call.');
      check(uuid(body.idempotencyKey),400,'A SIM call request needs a UUID idempotency key.');
      check(['hi','en'].includes(body.language),400,'Choose Hindi or English.');
      check(Object.keys(body).every(key=>['contactId','language','consentConfirmed','idempotencyKey'].includes(key)),400,'Select an approved contact; arbitrary destinations or call instructions are not accepted.');
      const contact=await contactFor(body.contactId);check(contact.role==='senior',400,'The wellbeing check-in bot can only call the senior account.');const requestHash=await sha256(JSON.stringify({actorId:session.userId,requestKey:body.idempotencyKey}));
      const id=[requestHash.slice(0,8),requestHash.slice(8,12),requestHash.slice(12,16),requestHash.slice(16,20),requestHash.slice(20,32)].join('-');
      const prior=await load(id);
      if(prior){check(canView(prior.seniorId)&&prior.contactId===contact.id&&prior.language===body.language,409,'This request key belongs to another call.');return reply({job:safeJob(prior),repeated:true});}
      const recent=jobs.filter(j=>j.contactId===contact.id&&Date.parse(j.createdAt)>now-86400000);
      check(recent.length<10,429,'This approved contact reached the ten-call-request daily limit.');
      const job={id,seniorId:contact.seniorId,contactId:contact.id,recipientRole:contact.role,language:body.language,requestedBy:session.userId,requestHash,status:'queued',state:{step:0},createdAt:clock,expiresAt:new Date(now+30*60000).toISOString(),externalDelivery:false,callAnswered:false,consentGranted:false,audioCount:0,transcriptStatus:'not_started',humanRead:false};
      // A unique contact/rate slot closes the concurrent count-then-insert race.
      const rateId=`sim-call-rate:${await sha256(contact.id)}:${new Date(now).toISOString().slice(0,10)}:${recent.length+1}`;
      try{await db.batch([event(db,owner,'sim_call_job',contact.seniorId,job,id),event(db,owner,'sim_call_nonce',contact.seniorId,{action:'request_rate_slot',jobId:id},rateId)]);}catch(error){if(conflict(error)){const duplicate=await load(id);if(duplicate&&duplicate.contactId===contact.id&&duplicate.language===body.language)return reply({job:safeJob(duplicate),repeated:true});throw new TelephonyError(409,'A concurrent request changed the call queue. Refresh before submitting again.');}throw error;}
      return reply({job:safeJob(job),notice:'Queued only. No number has been dialled.'},201);
    }
    if(path==='sim-calls/bridge/heartbeat'&&request.method==='POST') {
      await signedBridge();check(body.deviceReady===true,400,'Confirm the Linux Bluetooth mobile channel is ready.');
      await event(db,owner,'sim_call_bridge','',{deviceReady:true,createdAt:clock},`sim-call-heartbeat:${crypto.randomUUID()}`).run();return reply({ok:true});
    }
    if(path==='sim-calls/bridge/jobs'&&request.method==='GET') {
      await signedBridge();const selected=[];
      for(const job of jobs.filter(j=>j.status==='queued'&&Date.parse(j.expiresAt)>now).slice(0,10))try{await contactFor(job.contactId);selected.push(safeJob(job));}catch{}
      return reply({jobs:selected});
    }
    const match=path.match(/^sim-calls\/jobs\/([a-f\d-]{36})\/(claim|receipt|transcripts)$/i);
    if(match&&request.method==='POST') {
      check(uuid(match[1]),400,'Choose a valid SIM call job.');await signedBridge();
      const job=await load(match[1]);check(job&&canView(job.seniorId),404,'SIM call job not found in your care scope.');
      if(match[2]==='claim') {
        check(job.recipientRole==='senior',409,'This wellbeing call is not addressed to the senior account.');
        check(job.status==='queued'&&Date.parse(job.expiresAt)>now,409,'This call is expired or already claimed. It must never be automatically redialled.');
        const contact=await contactFor(job.contactId);
        check(contact.seniorId===job.seniorId&&contact.role===job.recipientRole,409,'The approved contact identity changed after this request. Inspect it before creating a fresh call request.');
        const lock=await callerLock();
        check(!lock.activeJobId,409,'Another SIM call owns the single caller. Inspect its terminal evidence; expiry never authorizes a new call automatically.');
        const leaseToken=crypto.randomUUID(),leaseExpiresAt=new Date(now+10*60000).toISOString(),next={...job,status:'claimed',leaseHash:await sha256(leaseToken),leaseExpiresAt,updatedAt:clock,state:{step:job.state.step+1}};
        // Reserve global lock first. If another claim wins, its CAS prevents this
        // request from changing its job. A crash here conservatively holds the lock.
        const reserved=await cas(lock,{...lock,activeJobId:job.id,lockedUntil:leaseExpiresAt},'sim_call_bridge').run();
        check(changed(reserved)===1,409,'The single caller changed. Refresh before claiming.');
        const result=await cas(job,next).run();check(changed(result)===1,409,'This call was already claimed. No second call is authorized.');
        return reply({job:{...safeJob(next),phone:contact.phone,leaseToken}});
      }
      check(typeof body.leaseToken==='string'&&await sha256(body.leaseToken)===job.leaseHash&&Date.parse(job.leaseExpiresAt)>now,403,'The SIM call lease is invalid or expired.');
      if(match[2]==='transcripts') {
        check(terminal.has(job.status)&&job.consentGranted===true&&job.audioCount>0,409,'Only consented recorded answers can be associated with transcript drafts.');
        check(Object.keys(body).every(key=>['leaseToken','draftIds'].includes(key))&&Array.isArray(body.draftIds)&&body.draftIds.length===job.audioCount&&body.draftIds.every(uuid)&&new Set(body.draftIds).size===body.draftIds.length,400,'Associate one saved transcript draft with each recorded answer.');
        if(job.transcriptStatus==='drafts_saved') {
          check(JSON.stringify(job.draftIds)===JSON.stringify(body.draftIds),409,'Different transcript drafts are already associated with this call.');
          return reply({ok:true,job:safeJob(job),repeated:true});
        }
        for(const ticketId of body.draftIds) {
          const draft=await load('speech-draft:'+ticketId,'speech_draft');
          check(draft&&draft.seniorId===job.seniorId&&draft.transcription?.ticketId===ticketId&&draft.transcription?.actorId===session.userId&&draft.transcription?.externalServiceUsed===false,403,'A transcript draft does not belong to this senior and coordinator.');
        }
        await getSenior(job.seniorId);
        const next={...job,transcriptStatus:'drafts_saved',draftIds:[...body.draftIds],updatedAt:clock,state:{step:job.state.step+1}};
        check(changed(await cas(job,next).run())===1,409,'This call transcript association changed. Refresh before retrying.');
        return reply({ok:true,job:safeJob(next),notice:'Saved transcript drafts still require human review; no words were approved automatically.'});
      }
      check(['claimed','originated'].includes(job.status),409,'This call already has terminal evidence. It will not be redialled.');
      check(Object.keys(body).every(key=>['leaseToken','status','callAnswered','consentGranted','audioCount'].includes(key)),400,'Only factual device receipt fields are accepted.');
      check(['originated',...terminal].includes(body.status),400,'Choose a supported factual call state.');
      check(!(job.status==='originated'&&body.status==='originated'),409,'CLI acceptance is already recorded.');
      // A receipt documents a past action; withdrawal cannot erase it. New
      // transcription tickets still require fresh scope and their own consent.
      await getSenior(job.seniorId);
      const recording=body.status==='answers_recorded';
      check(!recording||body.consentGranted===true&&body.audioCount===4&&body.callAnswered===true,400,'Four audio answers require explicit recording consent and answered-channel evidence.');
      check(body.status!=='declined'||body.consentGranted!==true&&!(body.audioCount>0),400,'A declined call must contain no recorded answers.');
      check(body.status!=='originated'||body.callAnswered!==true&&body.consentGranted!==true&&!(body.audioCount>0),400,'CLI acceptance cannot establish an answer, consent or recording.');
      const audioCount=Number.isInteger(body.audioCount)?body.audioCount:0;
      check(audioCount>=0&&audioCount<=4&&(!audioCount||body.consentGranted===true),400,'Audio metadata is inconsistent with recording consent.');
      check((body.audioCount===undefined||Number.isInteger(body.audioCount))&&(body.callAnswered===undefined||typeof body.callAnswered==='boolean')&&(body.consentGranted===undefined||typeof body.consentGranted==='boolean'),400,'Call evidence must use typed factual values.');
      check(body.consentGranted!==true||body.callAnswered===true,400,'Recording consent requires an answered channel.');
      check(body.status!=='submission_unknown'||body.callAnswered!==true&&body.consentGranted!==true&&audioCount===0,400,'An unknown submission cannot establish answered-channel or recording evidence.');
      const next={...job,status:body.status,callAnswered:body.callAnswered===true,consentGranted:body.consentGranted===true,audioCount,externalDelivery:body.callAnswered===true,transcriptStatus:'not_started',humanRead:false,updatedAt:clock,state:{step:job.state.step+1}};
      const result=await cas(job,next).run();check(changed(result)===1,409,'This call receipt changed. Inspect existing evidence before retrying.');
      if(terminal.has(body.status)) {
        const lock=await callerLock();
        if(lock.activeJobId===job.id)await cas(lock,{...lock,activeJobId:body.status==='submission_unknown'?job.id:null,lockedUntil:body.status==='submission_unknown'?'9999-12-31T00:00:00.000Z':null},'sim_call_bridge').run();
      }
      return reply({ok:true,job:safeJob(next),notice:body.status==='answers_recorded'?'Four audio files were recorded after consent. Transcription remains a separate reviewed draft.':'Recorded device evidence; no human care outcome is implied.'});
    }
    return reply({error:'Unsupported SIM call action.'},405);
  }catch(error){return reply({error:error instanceof TelephonyError?error.message:'The SIM call request could not be completed.'},error instanceof TelephonyError?error.status:500);}
}
