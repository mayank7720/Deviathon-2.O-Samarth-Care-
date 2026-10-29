import {canManageCare,isWorkspaceAdmin} from './access.mjs';
import {scanEvents} from './workflow-store.mjs';
import {CARE_NOTICE,careCheck as check,careUuid,careEvent,careCityKey,careOperationsState,validateCareAssignment,newCareCase,advanceCareCase} from './care-operations.mjs';

const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const visible=(session,id)=>session.scope?.includes('*')||session.scope?.includes(id);
const conflict=error=>error.status===409||/UNIQUE constraint|23505/i.test(String(error.message));
const rowLookup=(db,owner,kind,id)=>db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,kind).first();
const sameAssignment=(a,b)=>['seniorId','householdId','city','counsellorId','leaderId','backupId','source'].every(key=>a?.[key]===b?.[key]);

/** Assignment planning never changes auth memberships. All writes are human records. */
export async function handleCareOperationsRoute({path,request,body={},db,context,cohort,getSenior,event,storeMutation,now=Date.now()}){
  if(path!=='care-operations'&&!path.startsWith('care-operations/'))return null;
  try{
    const {session,owner}=context;
    check(context.authenticated&&context.authorized&&session,401,'Sign in to an assigned care workspace.');
    check(['coordinator','operations'].includes(session.role),403,'Care operations are available only to the assigned care team.');
    const canManageAssignments=isWorkspaceAdmin(session)&&session.scope?.includes('*')===true;
    const knownPaths=path==='care-operations'||path==='care-operations/assignments'||path==='care-operations/cases'||/^care-operations\/cases\/[^/]+$/.test(path);
    check(knownPaths,404,'Care operations route not found.');
    check(path==='care-operations'?request.method==='GET':path==='care-operations/assignments'||path==='care-operations/cases'?request.method==='POST':request.method==='PATCH',405,'Use the supported care operations method.');
    if(request.method!=='GET')check(canManageCare(session),403,'Only assigned care staff can record assignments or follow-up actions.');
    if(path==='care-operations/assignments')check(canManageAssignments,403,'Managing care assignments requires a workspace administrator with access to all seniors.');
    const seniorIds=cohort.seniors.filter(s=>visible(session,s.id)).map(s=>s.id);
    // Independent typed scan prevents signals from evicting authoritative care state.
    const source=await scanEvents(db,{owner,seniorIds,kinds:['care_assignment','care_followup'],limit:5000});
    const state=careOperationsState(cohort,source),stamp=new Date(now).toISOString(),actor=context.userId||session.userId||session.name||'Care coordinator';
    const scoped=async id=>{check(visible(session,id),403,'This senior is outside your assigned care scope.');return getSenior(id);};
    if(request.method==='GET'){
      const allowed=new Set();for(const id of seniorIds){await scoped(id);allowed.add(id);}
      const assignments=state.assignments.filter(a=>allowed.has(a.seniorId)),cases=state.cases.filter(c=>allowed.has(c.seniorId)),cities=new Set(assignments.map(a=>a.city));
      const directory=state.directory.filter(s=>cities.has(s.city));
      return reply({directory,assignments,cases,canManageAssignments,summary:{households:assignments.length,recordedAssignments:assignments.filter(a=>a.source==='recorded').length,openCases:cases.filter(c=>!['resolved','cancelled'].includes(c.status)).length,escalatedCases:cases.filter(c=>c.status==='escalated').length,resolvedCases:cases.filter(c=>c.status==='resolved').length},notice:CARE_NOTICE});
    }
    if(path==='care-operations/assignments'){
      check(careUuid(body.idempotencyKey),400,'An assignment needs a UUID idempotency key.');
      const senior=await scoped(body.seniorId),assignment=validateCareAssignment(body,senior,state.directory),requestId=`care-assignment-request:${actor}:${body.idempotencyKey}`;
      const saved=await rowLookup(db,owner,'care_assignment',requestId);
      if(saved){const prior=careEvent(saved);check(prior.seniorId===senior.id&&sameAssignment(prior.assignment,assignment),409,'This assignment key belongs to a different request.');return reply({assignment:prior.assignment,repeated:true});}
      const current=state.assignments.find(a=>a.seniorId===senior.id),ledger=state.cityLedgers.get(senior.city),counts={...ledger.counts};
      if(current.counsellorId!==assignment.counsellorId){
        check(Number.isInteger(counts[current.counsellorId])&&counts[current.counsellorId]>0&&Number.isInteger(counts[assignment.counsellorId]),409,'The city capacity ledger is incomplete. Refresh before assigning.');
        counts[current.counsellorId]--;counts[assignment.counsellorId]++;
      }
      check(Object.values(counts).every(count=>Number.isInteger(count)&&count>=0&&count<=2),409,'A care counsellor can own at most two separate households. Choose another counsellor.');
      const revision=ledger.revision+1,payload={entryType:'assignment',assignment,city:senior.city,revision,capacityCounts:counts,actor,updatedAt:stamp},id=`care-assignment-city:${careCityKey(senior.city)}:${revision}`;
      try{await db.batch([event(db,owner,'care_assignment',senior.id,payload,id),event(db,owner,'care_assignment',senior.id,{entryType:'request',assignment,revision,actor,updatedAt:stamp},requestId),event(db,owner,'audit',senior.id,{action:'care_assignment',actor,detail:'Planning assignment recorded; login access unchanged.'})]);}
      catch(error){if(conflict(error))return reply({error:'The city assignment ledger changed or this request was already recorded. Refresh before retrying.'},409);throw error;}
      const names=new Map(state.directory.map(s=>[s.id,s.name]));
      return reply({assignment:{...assignment,revision,updatedAt:stamp,counsellorName:names.get(assignment.counsellorId),leaderName:names.get(assignment.leaderId),backupName:names.get(assignment.backupId)},notice:'Planning assignment saved. Authentication and senior access permissions are unchanged.'},201);
    }
    if(path==='care-operations/cases'){
      const senior=await scoped(body.seniorId),value=newCareCase(body,senior,state.directory,actor,stamp),id=`care-case:${value.caseId}:1`,saved=await rowLookup(db,owner,'care_followup',id);
      if(saved){const previous=careEvent(saved);check(previous.seniorId===senior.id&&previous.category===value.category&&previous.action===value.action&&previous.assignedTo===value.assignedTo&&previous.note===value.note,409,'This case key belongs to another request.');return reply({case:previous,repeated:true});}
      try{await storeMutation(db,owner,'care_followup',senior.id,value,actor,id);}catch(error){if(conflict(error))return reply({error:'This follow-up key was already recorded. Refresh before retrying.'},409);throw error;}
      return reply({case:value,notice:'Follow-up recorded. No call, message or external service was dispatched.'},201);
    }
    const caseId=path.split('/').at(-1);check(careUuid(caseId),400,'Choose a valid follow-up identifier.');
    const current=state.cases.find(c=>c.caseId===caseId);check(current,404,'Follow-up not found in your care scope.');
    await scoped(current.seniorId);
    const value=advanceCareCase(current,body,state.directory,actor,stamp),id=`care-case:${caseId}:${value.revision}`;
    try{await storeMutation(db,owner,'care_followup',current.seniorId,value,actor,id);}catch(error){if(conflict(error))return reply({error:'This follow-up changed. Refresh before recording another action.'},409);throw error;}
    return reply({case:value,notice:'Human follow-up evidence saved. No external service was automatically dispatched.'});
  }catch(error){return reply({error:error.status?error.message:'Care operations could not be loaded or recorded.'},error.status||500);}
}
