import {canManageCare,isWorkspaceAdmin} from './access.mjs';
import { TelephonyError,checkTelephony as check,telephonyContacts,allowedTelephonyTemplates,assertContactConsent,assertTrialCallWindow,maskedPhone,smsText,sha256,verifyBridgeRequest,publicTelephonyJob,startTrialVoiceCall } from './telephony.mjs';
import {requestSavedVoiceDispatch} from './voice-dispatch.mjs';
import {initialCallBot,finishInterruptedCall} from './call-bot.mjs';
import {assertCallingPolicy} from './calling-policy.mjs';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
const changeCount=value=>Number(value?.meta?.changes??value?.changes??0);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const terminal=new Set(['delivered','failed','cancelled','expired','completed']);
const safeContact=c=>({id:c.id,seniorId:c.seniorId,role:c.role,userId:c.userId,name:c.name,allowedTemplates:allowedTelephonyTemplates(c.role),maskedPhone:maskedPhone(c.phone),verified:c.verified,smsConsent:c.smsConsent,callConsent:c.callConsent});

/** Resolve a saved job on the server. n8n only needs the opaque job ID. */
export async function dispatchSavedVoiceJob({jobId,db,context,env={},getSenior,now=Date.now(),fetchImpl=fetch}) {
  check(canManageCare(context?.session),403,'A saved care-team request is required for telephone calling.');
  const owner=context.owner;
  const load=async()=>{const row=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(jobId,owner,'telephony_job').first();check(row,404,'Telephone request not found.');return {...parse(row.payload),id:row.id,seniorId:row.senior_id};};
  const write=async(job,next)=>{const value={...next,state:{step:job.state.step+1}};const saved=await db.prepare("UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ? AND json_extract(payload, '$.state.step') = ?").bind(JSON.stringify(value),job.id,owner,'telephony_job',job.state.step).run();check(changeCount(saved)===1,409,'The telephone request changed. Do not resubmit a call.');return value;};
  let job=await load();
  check(context.session.scope?.includes('*')||context.session.scope?.includes(job.seniorId),403,'This telephone request is outside the assigned care scope.');
  check(job.channel==='voice_bot'&&job.status==='queued'&&Date.parse(job.expiresAt)>now,409,'This voice request is already submitted, expired or not queued.');
  const contact=telephonyContacts(env).find(c=>c.id===job.contactId);check(contact,404,'Approved contact not found.');assertContactConsent(contact,await getSenior(job.seniorId),'call');
  check(env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',503,'The credited calling provider is not enabled.');
  if(typeof db.callAutomation==='function')assertCallingPolicy((await db.callAutomation('list',{})).control.callingPolicy,now,!!job.sourceRequestId);else assertTrialCallWindow(now);
  if(db.backend==='supabase'){
    await requestSavedVoiceDispatch(job,env,{fetchImpl});
    const saved=await load();
    return {job:publicTelephonyJob(saved),provider:'twilio_trial',reference:saved.providerId,status:saved.status,externalDelivery:saved.externalDelivery===true};
  }
  let origin;try{origin=new URL(env.SAMARTH_PUBLIC_URL);}catch{throw new TelephonyError(503,'Configure the public care origin for signed call callbacks.');}
  check(origin.protocol==='https:'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash&&origin.pathname==='/',503,'Call callbacks require the configured HTTPS care origin.');
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),callbackTokenHash=await sha256(token),base=`${origin.origin}/api/telephony/twilio`;
  job=await write(job,{...job,status:'submitting',voiceState:initialCallBot(job.language,{spokenChoices:env.SAMARTH_CALL_BOT_SPOKEN_CHOICES==='true',recipientRole:job.recipientRole||'senior',notice:{reference:job.seniorId}}),callbackTokenHash,callbackOrigin:origin.origin,updatedAt:new Date(now).toISOString()});
  try {
    const result=await startTrialVoiceCall({...job,phone:contact.phone,callbackUrl:`${base}/checkin/${job.id}/${token}?phase=prompt&step=0`,statusCallbackUrl:`${base}/status/${job.id}/${token}`},env,{fetchImpl});
    const current=await load();
    check(!current.providerId||current.providerId===result.providerId,409,'The provider call identity changed. Inspect the call log.');
    if(current.status!=='submitting')return {job:publicTelephonyJob(current),provider:'twilio_trial',reference:result.providerId,status:current.status,externalDelivery:current.externalDelivery===true};
    const saved=await write(current,{...current,provider:'twilio_trial',providerId:result.providerId,status:current.status==='submitting'?'accepted':current.status,updatedAt:new Date(now).toISOString()});
    return {job:publicTelephonyJob(saved),provider:'twilio_trial',reference:result.providerId,status:saved.status,externalDelivery:false};
  }catch(error){
    const current=await load();
    if(current.status!=='submitting'&&current.providerId)return {job:publicTelephonyJob(current),provider:'twilio_trial',reference:current.providerId,status:current.status,externalDelivery:current.externalDelivery===true};
    if(current.status==='submitting')await write(current,{...current,status:error.callNotPlaced===true?'failed':'submission_unknown',...(error.callNotPlaced===true?{voiceState:finishInterruptedCall(current.voiceState)}:{}),updatedAt:new Date(now).toISOString(),lastError:error.callNotPlaced===true?'No call was placed. Check the trial settings and verified recipient before creating another request.':'The call submission outcome is not confirmed. Inspect the provider before requesting another call.'});
    throw error;
  }
}

/** All handlers retain the normal verified coordinator session and fresh RLS.
 * The separate Android HMAC grants no role and never replaces account access.
 */
export async function handleTelephonyRoute({path,request,body={},rawBody,db,context,env={},rows=[],getSenior,event,asOfDate,now=Date.now(),fetchImpl=fetch}) {
  if(!path.startsWith('telephony/'))return null;
  try {
    const session=context?.session,owner=context?.owner;
    check(context?.authenticated&&context?.authorized&&session,401,'Sign in to an assigned care workspace.');
    check(['coordinator','operations'].includes(session.role),403,'Telephone delivery records are available to the assigned care team.');
    if(path==='telephony/routing'&&request.method==='GET')return reply(typeof db.notificationRouting==='function'?await db.notificationRouting('status'): {routes:[],automaticSms:false,callRequests:'Requests notify care staff; calls require a separate approved action.'});
    if(path==='telephony/bridge/heartbeat'&&request.method==='POST') {
      const signed=await bridge();
      check(body.deviceReady===true,400,'A heartbeat must confirm a connected local gateway.');
      await db.batch([event(db,owner,'telephony_bridge','',{status:'online',deviceReady:true,createdAt:new Date(now).toISOString()},`heartbeat:${signed.id}`),event(db,owner,'telephony_bridge_nonce','',{action:'heartbeat'},signed.id)]);
      return reply({ok:true});
    }
    if(path==='telephony/bridge/jobs'&&request.method==='GET'&&typeof db.notificationRouting==='function')await db.notificationRouting('process');
    const contactMap=new Map(telephonyContacts(env).map(c=>[c.id,c]));
    for(const row of rows.filter(r=>r.kind==='telephony_contact')){const value=parse(row.payload)||row;if(value.contact)contactMap.set(value.contact.id,value.contact);}
    if(typeof db.accountContacts==='function') {
      contactMap.clear();
      for(const contact of await db.accountContacts())contactMap.set(contact.id,contact);
    }
    env={...env,SAMARTH_TELEPHONY_CONTACTS_JSON:JSON.stringify([...contactMap.values()])};
    const contacts=telephonyContacts(env);
    const canView=id=>session.scope?.includes('*')||session.scope?.includes(id);
    const contactFor=async(id,channel)=>{const contact=contacts.find(c=>c.id===id);check(contact,404,'Approved contact not found.');check(canView(contact.seniorId),403,'This contact is outside the assigned care scope.');const senior=await getSenior(contact.seniorId);assertContactConsent(contact,senior,channel);return contact;};
    const find=async id=>{const row=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,'telephony_job').first();check(row&&canView(row.senior_id),404,'Telephone job not found in this assignment.');return {...parse(row.payload),id:row.id,seniorId:row.senior_id};};
    async function bridge() {
      check(canManageCare(session),403,'The Android relay requires a coordinator account.');
      const raw=request.method==='GET'?'':rawBody??JSON.stringify(body);
      const signed=await verifyBridgeRequest(request,raw,env,now);
      const used=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(signed.id,owner,'telephony_bridge_nonce').first();
      check(!used,409,'This Android bridge request has already been applied.');
      return signed;
    }
    async function update(job,next,signed) {
      const value={...next,state:{step:(job.state?.step||0)+1}},payload=JSON.stringify(value),stamp=new Date(now).toISOString();
      const statements=[db.prepare("UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ? AND json_extract(payload, '$.state.step') = ?").bind(payload,job.id,owner,'telephony_job',job.state?.step||0)];
      if(signed)statements.push(db.prepare('INSERT OR IGNORE INTO care_events (id,owner,kind,senior_id,payload,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM care_events WHERE id = ? AND owner = ? AND kind = ? AND payload = ?)').bind(signed.id,owner,'telephony_bridge_nonce',job.seniorId,JSON.stringify({jobId:job.id,action:next.status}),stamp,job.id,owner,'telephony_job',payload));
      const result=await db.batch(statements);check(changeCount(result[0])===1,409,'The telephone job changed. Refresh before retrying.');return value;
    }
    const freshJobs=path==='telephony/bridge/jobs'&&typeof db.scanEvents==='function'?await db.scanEvents({owner,seniorIds:session.scope?.includes('*')?null:session.scope,kinds:['telephony_job'],limit:5000}):rows;
    const jobRows=freshJobs.filter(r=>r.kind==='telephony_job'&&canView(r.seniorId||r.senior_id)).map(r=>({...(r.payload?parse(r.payload):r),id:r.id,seniorId:r.seniorId||r.senior_id}));
    if(path==='telephony/contacts'&&request.method==='POST'){
      check(db.backend!=='supabase',400,'Manage mobile numbers under Accounts. Recipients must be linked to an active account.');
      check(isWorkspaceAdmin(session),403,'Only a workspace administrator can approve a test destination.');
      check(body.ownerConfirmed===true,400,'Confirm you control this test number and consent to contact.');
      await getSenior(body.seniorId);
      const contact=telephonyContacts({SAMARTH_TELEPHONY_CONTACTS_JSON:JSON.stringify([{id:body.id||crypto.randomUUID(),seniorId:body.seniorId,role:body.role,phone:body.phone,verified:true,smsConsent:body.smsConsent===true,callConsent:body.callConsent===true}])})[0];
      await event(db,owner,'telephony_contact',contact.seniorId,{contact,verification:'Administrator confirmed control and channel consent',actorId:session.userId}).run();
      return reply({contact:safeContact(contact)},201);
    }
    if(path==='telephony/config'&&request.method==='GET') {
      const heartbeat=rows.filter(r=>r.kind==='telephony_bridge'&&r.status==='online').at(-1);
      const providerKeys=!!env.TWILIO_ACCOUNT_SID&&!!env.TWILIO_AUTH_TOKEN&&!!env.TWILIO_FROM_NUMBER;
      return reply({contacts:contacts.filter(c=>canView(c.seniorId)).map(safeContact),androidBridgeConfigured:typeof env.SAMARTH_ANDROID_BRIDGE_SECRET==='string'&&env.SAMARTH_ANDROID_BRIDGE_SECRET.length>=32,androidLastSeenAt:heartbeat?.createdAt||null,androidOnline:!!heartbeat&&now-Date.parse(heartbeat.createdAt)<120000,voiceBotConfigured:env.SAMARTH_TWILIO_TRIAL_ENABLED==='true'&&providerKeys,voiceBotSetup:{providerConfigured:providerKeys,enabled:env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',spokenChoices:env.SAMARTH_CALL_BOT_SPOKEN_CHOICES==='true',mode:env.SAMARTH_CALL_BOT_SPOKEN_CHOICES==='true'?'guided-speech-call':'guided-keypad-call',maxCallSeconds:240,paidAccountsAllowed:false,liveVerified:false},voiceBotNotice:'AI Call Bot uses Hindi/English speech recognition, guided questions and role-specific care notices after recipient consent. Calls use the selected account’s current permitted number. A trial-verified receiving number is required. Paid accounts and automatic redials are blocked. This is not an open-ended LLM conversation.',billingNotice:'The relay software has no SMS API vendor fee. Carrier SMS/call charges or plan limits still apply.'});
    }
    if(path==='telephony/jobs'&&request.method==='GET')return reply({jobs:jobRows.slice(-100).reverse().map(job=>({...publicTelephonyJob(job),review:rows.find(r=>r.id==='call-review:'+job.id&&r.kind==='call_bot_review')||null}))});
    if(path==='telephony/jobs'&&request.method==='POST') {
      check(canManageCare(session),403,'Only a care coordinator can request telephone delivery.');
      check(['sms','android_dialer','voice_bot'].includes(body.channel),400,'Choose SMS, an assisted Android call or a credited-provider check-in bot.');
      if(body.channel==='voice_bot')check(env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',503,'Connect the credited calling provider before requesting an autonomous call.');
      check(body.consentConfirmed===true,400,'Confirm the destination owner agreed to this communication.');
      check(typeof body.idempotencyKey==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(body.idempotencyKey),400,'Supply one unique request key for this communication.');
      const contact=await contactFor(body.contactId,body.channel==='sms'?'sms':'call');
      const template=body.template||allowedTelephonyTemplates(contact.role)[0],language=body.language||'en',text=smsText(template,language,contact.role);
      check(body.template!=='weekly_summary',400,'Weekly summaries must use the reviewed protected inbox; SMS may send a follow-up prompt.');
      if(body.channel==='voice_bot'){
        const voiceTemplate={senior:'checkin',family:'followup',coordinator:'staff_alert',operations:'escalation'}[contact.role];
        check(template===voiceTemplate,400,'Choose the call purpose for this recipient account type.');
        if(typeof db.callAutomation==='function')assertCallingPolicy((await db.callAutomation('list',{})).control.callingPolicy,now,!!body.sourceRequestId);else assertTrialCallWindow(now);
        check(!jobRows.some(j=>j.channel==='voice_bot'&&['submitting','accepted','ringing','answered','submission_unknown'].includes(j.status)),409,'Inspect the existing call outcome before starting another trial call.');
        check(jobRows.filter(j=>j.channel==='voice_bot'&&Date.parse(j.createdAt)>now-86400000).length<5,429,'The showcase is limited to five bot call requests per day.');
      }
      check(!Object.keys(body).some(k=>['phone','to','text','message','url','callbackUrl'].includes(k)),400,'Choose an assigned contact and a fixed privacy-preserving template.');
      if(body.sourceRequestId!==undefined){
        check(body.channel==='voice_bot'&&/^[a-f\d-]{36}$/iu.test(body.sourceRequestId)&&typeof db.phoneIntake==='function',400,'Choose a saved phone-support request for this call.');
        const source=(await db.phoneIntake('list',{})).requests?.find(r=>r.id===body.sourceRequestId&&r.seniorId===contact.seniorId&&r.status!=='closed');
        check(source,403,'The selected care request is unavailable or belongs to another senior.');
        check(contact.role!=='coordinator'||source.assignedTo===contact.userId,403,'This request is assigned to a different care coordinator.');
      }
      const requestHash=await sha256(JSON.stringify({userId:session.userId,contactId:contact.id,channel:body.channel,template,language,sourceRequestId:body.sourceRequestId||null,idempotencyKey:body.idempotencyKey}));
      const existing=jobRows.find(j=>j.requestHash===requestHash);
      if(existing)return reply({job:publicTelephonyJob(existing),duplicate:true});
      const since=now-24*60*60000,count=jobRows.filter(j=>j.contactId===contact.id&&Date.parse(j.createdAt)>since).length;
      check(count<10,429,'This showcase contact has reached its ten-request daily limit.');
      const id=[requestHash.slice(0,8),requestHash.slice(8,12),requestHash.slice(12,16),requestHash.slice(16,20),requestHash.slice(20,32)].join('-');
      const job={id,seniorId:contact.seniorId,contactId:contact.id,recipientRole:contact.role,channel:body.channel,template,language,text,...(body.sourceRequestId?{sourceRequestId:body.sourceRequestId}:{}),status:'queued',requestHash,state:{step:0},createdAt:new Date(now).toISOString(),expiresAt:new Date(now+30*60000).toISOString(),asOfDate,requestedBy:session.userId,externalDelivery:false,deliveredToHandset:false,humanRead:false};
      try{await event(db,owner,'telephony_job',job.seniorId,job,job.id).run();}catch(error){if(error.status===409||String(error.message).includes('UNIQUE constraint'))return reply({job:publicTelephonyJob(await find(id)),duplicate:true});throw error;}
      return reply({job:publicTelephonyJob(job),notice:body.channel==='sms'?'Queued for the paired Android relay; not yet sent.':body.channel==='android_dialer'?'Queued to open the paired Android dialer. A person must press Call.':'The credited-provider voice check-in is queued. Start it explicitly or dispatch the saved job through n8n.'},201);
    }
    if(path==='telephony/bridge/jobs'&&request.method==='GET') {
      await bridge();const jobs=[];
      for(const job of jobRows.filter(j=>['sms','android_dialer'].includes(j.channel)&&(j.status==='queued'||j.status==='processing'&&Date.parse(j.leaseExpiresAt||'')<now)).slice(0,10)) {
        if(Date.parse(job.expiresAt)<now)continue;
        try{await contactFor(job.contactId,job.channel==='sms'?'sms':'call');jobs.push(publicTelephonyJob(job));}catch{/* Withdrawn contacts never reach the device. */}
      }
      return reply({jobs});
    }
    const match=path.match(/^telephony\/jobs\/([a-f0-9-]{36})\/(claim|receipt|cancel|dial|start|review)$/i);
    if(match) {
      const job=await find(match[1]);check(canManageCare(session),403,'Only a coordinator can change telephone delivery.');
      if(match[2]==='review'&&request.method==='POST'){
        check(job.channel==='voice_bot'&&job.voiceState?.complete===true,409,'Wait for the saved call outcome before reviewing.');
        check(Object.keys(body).every(k=>k==='outcome')&&typeof body.outcome==='string'&&body.outcome.trim().length>=5&&body.outcome.length<=1600,400,'Record the checked call outcome in 5–1,600 characters.');
        const prior=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind('call-review:'+job.id,owner,'call_bot_review').first();
        if(prior)return reply({ok:true,repeated:true});
        await event(db,owner,'call_bot_review',job.seniorId,{jobId:job.id,outcome:body.outcome.trim(),actorId:session.userId,createdAt:new Date(now).toISOString()},'call-review:'+job.id).run();
        return reply({ok:true,notice:'Call review saved. Complete the linked care follow-up separately.'});
      }
      if(match[2]==='start'&&request.method==='POST')return reply(await dispatchSavedVoiceJob({jobId:job.id,db,context,env,getSenior,now,fetchImpl}),202);
      if(match[2]==='cancel'&&request.method==='POST') {
        check(job.status==='queued',409,'Only a queued, undispatched request can be cancelled.');
        return reply({job:publicTelephonyJob(await update(job,{...job,status:'cancelled',updatedAt:new Date(now).toISOString()}))});
      }
      if(match[2]==='dial'&&request.method==='POST') {
        check(job.channel==='android_dialer'&&job.status==='queued',409,'This assisted call is not awaiting a dialer.');
        const contact=await contactFor(job.contactId,'call');
        const next=await update(job,{...job,status:'awaiting_device_action',updatedAt:new Date(now).toISOString()});
        return reply({job:publicTelephonyJob(next),dialUri:`tel:${contact.phone}`,externalDelivery:false,notice:'The phone dialer must be opened and the device owner must press Call. Opening a dialer does not prove a connected call.'});
      }
      if(match[2]==='claim'&&request.method==='POST') {
        const signed=await bridge();
        check(['sms','android_dialer'].includes(job.channel),409,'Provider voice jobs cannot be claimed by the Android relay.');
        if(body.receiptOnly===true){
          check(job.channel==='sms'&&['processing','accepted','sent'].includes(job.status)&&Date.parse(job.leaseExpiresAt||'')<=now&&Date.parse(job.createdAt)>now-86400000,409,'This SMS is not awaiting receipt recovery.');
          const leaseToken=crypto.randomUUID();
          const next=await update(job,{...job,leaseHash:await sha256(leaseToken),leaseExpiresAt:new Date(now+10*60000).toISOString(),updatedAt:new Date(now).toISOString()},signed);
          // The gateway may only inspect this existing message. No phone number
          // is released and no new send is authorised by receipt recovery.
          return reply({job:{...publicTelephonyJob(next),leaseToken,receiptOnly:true}});
        }
        check(Date.parse(job.expiresAt)>now,409,'This telephone request has expired.');
        check(job.status==='queued'||job.status==='processing'&&Date.parse(job.leaseExpiresAt||'')<now,409,'This job is already claimed or has reached a provider state.');
        const contact=await contactFor(job.contactId,job.channel==='sms'?'sms':'call'),leaseToken=crypto.randomUUID();
        const next=await update(job,{...job,status:'processing',leaseHash:await sha256(leaseToken),leaseExpiresAt:new Date(now+10*60000).toISOString(),updatedAt:new Date(now).toISOString()},signed);
        return reply({job:{...publicTelephonyJob(next),phone:contact.phone,leaseToken}});
      }
      if(match[2]==='receipt'&&request.method==='POST') {
        const signed=await bridge();
        check(typeof body.leaseToken==='string'&&await sha256(body.leaseToken)===job.leaseHash&&Date.parse(job.leaseExpiresAt)>now,403,'The Android job lease is invalid or expired.');
        check(!terminal.has(job.status),409,'This telephone job already has a terminal receipt.');
        check(job.status==='processing'||['accepted','sent'].includes(job.status),409,'Claim the telephone job before submitting a receipt.');
        const statuses=job.channel==='sms'?['accepted','sent','delivered','failed','cancelled']:['awaiting_device_action','failed'];
        check(statuses.includes(body.status),400,'Unsupported device delivery state.');
        check(job.channel!=='sms'||typeof body.providerId==='string'&&body.providerId===job.id,400,'The device receipt must refer to the assigned message identifier.');
        // A contact edit cannot erase an already-sent message's receipt. The
        // signed lease records evidence only; new sends still recheck consent.
        const rank={processing:0,accepted:1,sent:2,delivered:3};
        check(!['accepted','sent','delivered'].includes(body.status)||rank[body.status]>=rank[job.status],409,'A delivery receipt cannot move backwards.');
        const next=await update(job,{...job,status:body.status,provider:job.channel==='sms'?'android_sms_gate':'android_dialer',providerId:body.providerId||null,externalDelivery:job.channel==='sms'&&['sent','delivered'].includes(body.status),deliveredToHandset:body.status==='delivered',humanRead:false,lastError:body.status==='failed'?'The paired device reported a sending failure.':null,updatedAt:new Date(now).toISOString()},signed);
        return reply({ok:true,job:publicTelephonyJob(next)});
      }
    }
    return reply({error:'Unsupported telephone action.'},405);
  }catch(error){return reply({error:error instanceof TelephonyError?error.message:'The telephone request could not be completed.'},error instanceof TelephonyError?error.status:500);}
}
