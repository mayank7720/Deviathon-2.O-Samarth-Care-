/** Fictional planning roster and recorded human follow-ups. These are not access grants. */
export const CARE_CATEGORIES=Object.freeze(['wellbeing','clinical_review','companionship','home_safety','daily_assistance']);
export const CARE_STATUSES=Object.freeze(['contact_attempted','contact_confirmed','escalated','resolved','cancelled']);
export const CARE_CHANNELS=Object.freeze(['phone','sms','in_app','in_person']);
export const CARE_RESULTS=Object.freeze(['no_answer','reached','failed']);
export const CARE_NOTICE='Fictional planning roster; illustrative assignments are not staff employment, availability or login permissions. Each demo senior represents one separate household; couples are not inferred. Cases contain coordinator-entered actions and outcomes, not automatically dispatched services.';
export class CareOperationsError extends Error {constructor(status,message){super(message);this.status=status;}}
export function careCheck(ok,status,message){if(!ok)throw new CareOperationsError(status,message);}
export const careUuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
export function careText(value,label,min=10,max=1600){careCheck(typeof value==='string'&&value.trim().length>=min&&value.length<=max,400,`${label} must contain ${min}-${max} characters.`);return value.trim();}
export const careCityKey=city=>encodeURIComponent(city);
export function careEvent(row){const payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;return {...row,...payload,kind:row.kind,owner:row.owner,seniorId:row.senior_id||row.seniorId,createdAt:typeof payload?.createdAt==='string'?payload.createdAt:row.created_at||row.createdAt};}

export function createCarePlanning(cohort){
  const cities=[...new Set(cohort.seniors.map(s=>s.city))].sort(),directory=[],assignments=[];
  for(const city of cities){
    const seniors=cohort.seniors.filter(s=>s.city===city).sort((a,b)=>a.id.localeCompare(b.id)),key=careCityKey(city);
    const leaders=[0,1].map(i=>({id:`planning:${key}:leader:${i+1}`,name:`${city} Care Leader ${i+1}`,role:'leader',city,fictional:true}));
    // Two spare counsellors make a safe reassignment possible without overloading a household owner.
    const counsellors=Array.from({length:Math.ceil(seniors.length/2)+2},(_,i)=>({id:`planning:${key}:counsellor:${i+1}`,name:`${city} Care Counsellor ${i+1}`,role:'counsellor',city,maxFamilies:2,fictional:true}));
    directory.push(...leaders,...counsellors);
    seniors.forEach((senior,i)=>assignments.push({seniorId:senior.id,householdId:senior.id,city,counsellorId:counsellors[Math.floor(i/2)].id,leaderId:leaders[0].id,backupId:counsellors[(Math.floor(i/2)+1)%counsellors.length].id,source:'illustrative',revision:0}));
  }
  return {directory,assignments};
}

export function validateCareAssignment(value,senior,directory){
  const find=(id,role,label)=>{const entry=directory.find(s=>s.id===id);careCheck(entry?.role===role&&entry.city===senior.city,400,`${label} must be a ${role} in the senior's city.`);return entry;};
  find(value.counsellorId,'counsellor','Primary owner');find(value.leaderId,'leader','Care leader');find(value.backupId,'counsellor','Backup');
  careCheck(value.counsellorId!==value.backupId,400,'Choose a distinct backup counsellor.');
  return {seniorId:senior.id,householdId:senior.id,city:senior.city,counsellorId:value.counsellorId,leaderId:value.leaderId,backupId:value.backupId,source:'recorded'};
}

export function careOperationsState(cohort,rows=[]){
  const planning=createCarePlanning(cohort),events=rows.map(careEvent),bySenior=new Map(planning.assignments.map(a=>[a.seniorId,a])),cityLedgers=new Map();
  const assignmentEvents=events.filter(e=>e.kind==='care_assignment'&&e.entryType==='assignment').sort((a,b)=>a.revision-b.revision);
  for(const entry of assignmentEvents){
    if(!bySenior.has(entry.seniorId))continue;
    const previous=bySenior.get(entry.seniorId);
    if(entry.revision>previous.revision)bySenior.set(entry.seniorId,{...entry.assignment,revision:entry.revision,updatedAt:entry.updatedAt,actor:entry.actor});
    if(entry.revision>(cityLedgers.get(entry.city)?.revision||0))cityLedgers.set(entry.city,{revision:entry.revision,counts:entry.capacityCounts});
  }
  const names=new Map(planning.directory.map(s=>[s.id,s.name]));
  const assignments=[...bySenior.values()].map(a=>({...a,counsellorName:names.get(a.counsellorId),leaderName:names.get(a.leaderId),backupName:names.get(a.backupId)}));
  for(const city of new Set(planning.directory.map(s=>s.city)))if(!cityLedgers.has(city)){
    const counts=Object.fromEntries(planning.directory.filter(s=>s.city===city&&s.role==='counsellor').map(s=>[s.id,0]));
    for(const assignment of planning.assignments.filter(a=>a.city===city))counts[assignment.counsellorId]++;
    cityLedgers.set(city,{revision:0,counts});
  }
  const groups=new Map();
  for(const entry of events.filter(e=>e.kind==='care_followup')){if(!careUuid(entry.caseId)||!Number.isInteger(entry.revision))continue;const history=groups.get(entry.caseId)||[];history.push(entry);groups.set(entry.caseId,history);}
  const cases=[...groups.entries()].map(([id,entries])=>{
    const history=entries.sort((a,b)=>a.revision-b.revision),latest=history.at(-1);
    return {...latest,id,caseId:id,assignedToName:names.get(latest.assignedTo),escalationTargetName:names.get(latest.escalationTarget),history:history.map(e=>({revision:e.revision,status:e.status,note:e.note,actor:e.actor,updatedAt:e.updatedAt,contactChannel:e.contactChannel,contactResult:e.contactResult,escalationTarget:e.escalationTarget,outcome:e.outcome})),historyComplete:history.length===latest.revision&&history[0]?.revision===1};
  }).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return {directory:planning.directory,assignments,cases,cityLedgers};
}

export function newCareCase(body,senior,directory,actor,now){
  careCheck(careUuid(body.idempotencyKey),400,'A new follow-up needs a UUID idempotency key.');
  careCheck(CARE_CATEGORIES.includes(body.category),400,'Choose a supported care follow-up category.');
  const assigned=directory.find(s=>s.id===body.assignedTo);
  careCheck(assigned&&assigned.city===senior.city,400,'Assign a planning care-team member in the senior\'s city.');
  return {id:body.idempotencyKey,caseId:body.idempotencyKey,seniorId:senior.id,category:body.category,action:careText(body.action,'Next human action'),note:careText(body.note,'Evidence and context'),assignedTo:assigned.id,status:'open',revision:1,actor,createdAt:now,updatedAt:now,externalDelivery:false};
}

export function advanceCareCase(current,body,directory,actor,now){
  careCheck(Number.isInteger(body.revision)&&body.revision===current.revision,409,'This follow-up changed. Refresh before recording another action.');
  careCheck(!['resolved','cancelled'].includes(current.status),409,'This follow-up is closed. Create a new follow-up for a new concern.');
  careCheck(CARE_STATUSES.includes(body.status),400,'Choose a supported follow-up status.');
  const note=careText(body.note,'Action evidence');
  const contactStates=['contact_attempted','contact_confirmed'];
  if(body.contactChannel!==undefined)careCheck(CARE_CHANNELS.includes(body.contactChannel),400,'Choose phone, SMS, in-app or in-person contact.');
  if(body.contactResult!==undefined)careCheck(CARE_RESULTS.includes(body.contactResult),400,'Choose reached, no answer or failed.');
  if(contactStates.includes(body.status))careCheck(CARE_CHANNELS.includes(body.contactChannel)&&CARE_RESULTS.includes(body.contactResult),400,'Record the contact channel and manual result.');
  if(body.status==='contact_confirmed')careCheck(body.contactResult==='reached',400,'Confirmed contact requires a coordinator-recorded reached result.');
  if(body.status==='contact_attempted')careCheck(body.contactResult!=='reached',400,'Use confirmed contact when the person was reached.');
  // Loaded case objects contain database metadata. Only care fields belong in
  // the next append-only revision, not owner/sequence/history envelopes.
  const next=Object.fromEntries(['id','caseId','seniorId','category','action','assignedTo','createdAt','externalDelivery','contactChannel','contactResult','escalationTarget','outcome'].filter(key=>current[key]!==undefined).map(key=>[key,current[key]]));
  Object.assign(next,{status:body.status,note,revision:current.revision+1,actor,updatedAt:now});
  if(body.contactChannel!==undefined)next.contactChannel=body.contactChannel;
  if(body.contactResult!==undefined)next.contactResult=body.contactResult;
  if(body.status==='escalated'){
    const target=directory.find(s=>s.id===body.escalationTarget),assigned=directory.find(s=>s.id===current.assignedTo);
    careCheck(target?.role==='leader'&&target.city===assigned?.city,400,'Escalate to a care leader in the senior\'s city.');
    next.escalationTarget=target.id;
  }else careCheck(body.escalationTarget===undefined,400,'Choose an escalation target only when escalating.');
  if(body.status==='resolved')next.outcome=careText(body.outcome,'Recorded outcome',5);
  else if(body.outcome!==undefined)next.outcome=careText(body.outcome,'Recorded outcome',5);
  return next;
}
