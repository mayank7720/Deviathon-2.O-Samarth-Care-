import {canManageCare} from './access.mjs';
import {buildIvrPrompt,processIvrAnswer} from './communications.mjs';
import {workflow} from './workflow-store.mjs';

const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const check=(ok,status,message)=>{if(!ok)throw Object.assign(new Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/iu.test(value);
const text=(value,label,min=0,max=1600)=>{check(typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value),400,`${label} must contain ${min}–${max} characters.`);return value.trim();};
const calendar=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const fields=['requestId','seniorId','action','details','dueDate','priority','status','revision','createdBy','createdByRole','createdByName','assignedTo','assignedToName','createdAt','updatedAt','reply','outcome','checkinId'];
const clean=row=>Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
const closed=status=>['completed','cancelled'].includes(status);

/** Shared, non-clinical follow-ups. Private staff case notes stay in care_followup. */
export async function handlePortalCareRoute({path,request,body,db,context,rows,getSenior,event,asOfDate,onMutation}){
  if(!['portal-care','portal-care/requests','checkins'].includes(path)&&!path.startsWith('portal-care/requests/'))return null;
  try{
    const {session,owner}=context;
    check(context.authenticated&&context.authorized&&session?.userId,401,'Sign in to your care account.');
    const staff=canManageCare(session),actorId=session.userId,url=new URL(request.url);
    check(staff||['senior','family'].includes(session.role),403,'This care account cannot use shared follow-ups.');
    check(calendar(asOfDate),503,'The workspace calendar is unavailable.');
    async function seniorFor(id){const senior=await getSenior(id);check(senior,404,'Senior not found.');if(session.role==='family')check(senior.familyConsent===true,403,'Family sharing consent has been withdrawn.');return senior;}
    async function assignees(id){
      if(typeof db.conversationRecipients==='function')return (await db.conversationRecipients(id)).filter(m=>m.role==='coordinator'||m.role==='operations'&&m.isAdmin===true);
      const members=await workflow(db,'members_get',{workspaceId:session.workspaceId||'primary'});
      return members.filter(m=>m.status==='active'&&(m.role==='coordinator'||m.role==='operations'&&!!m.is_admin)).filter(m=>{const scope=typeof m.scope_json==='string'?JSON.parse(m.scope_json):m.scope_json||[];return scope.includes('*')||scope.includes(id);}).map(m=>({userId:m.user_id,name:m.display_name,role:m.role,isAdmin:!!m.is_admin}));
    }
    function requestState(){
      // Use the saved JSON timestamp for immutable request identity. The event
      // envelope has its own independently recorded timestamp.
      const saved=row=>({...row,...(typeof row.payload==='string'?JSON.parse(row.payload):row.payload||{})});
      const initial=rows.filter(row=>row.kind==='care_request').map(saved),states=rows.filter(row=>row.kind==='care_request_state').map(saved),result=[];
      for(const row of initial){const history=states.filter(item=>item.requestId===row.requestId).sort((a,b)=>a.revision-b.revision);result.push({...clean(row),...clean(history.at(-1)||{}),id:row.requestId,history:[row,...history].map(item=>({status:item.status,revision:item.revision,reply:item.reply||'',outcome:item.outcome||'',actorName:item.actorName||item.createdByName,updatedAt:item.updatedAt||item.createdAt}))});}
      return result;
    }
    async function write(events,seniorId,action){await db.batch([...events,event(db,owner,'audit',seniorId,{actor:session.name,actorId,action,role:session.role})]);}
    function initialRequest(input,seniorId,id,now){
      const dueDate=input.dueDate||asOfDate;check(calendar(dueDate),400,'Choose a valid follow-up date.');
      check(['routine','today','prompt'].includes(input.priority||'routine'),400,'Choose a valid priority.');
      return {requestId:id,seniorId,action:text(input.action,'Follow-up action',3,240),details:text(input.details||'','Shared details',0,1600),dueDate,priority:input.priority||'routine',status:'requested',revision:1,createdBy:actorId,createdByRole:session.role,createdByName:session.name||session.role,assignedTo:null,assignedToName:null,createdAt:now,updatedAt:now,actorId,actorName:session.name||session.role};
    }
    if(path==='portal-care'&&request.method==='GET'){
      const selected=url.searchParams.get('seniorId');if(selected)await seniorFor(selected);
      const requests=[];for(const row of requestState()){if(selected&&row.seniorId!==selected)continue;try{await seniorFor(row.seniorId);requests.push(row);}catch{/* Do not expose revoked household data. */}}
      const checkins=[];for(const row of rows.filter(row=>row.kind==='checkin').slice().reverse()){if(selected&&row.seniorId!==selected)continue;try{await seniorFor(row.seniorId);checkins.push({id:row.checkinId,seniorId:row.seniorId,date:row.date,language:row.language,answers:row.answers,note:row.note,summary:row.summary,reportedBy:row.reportedBy,reportedByRole:row.reportedByRole,createdAt:row.createdAt,requestId:row.requestId||null});}catch{/* No consent, no family history. */}}
      const legacy=[];if(staff)for(const row of rows.filter(row=>row.kind==='task')){if(selected&&row.seniorId!==selected)continue;try{await seniorFor(row.seniorId);legacy.push({id:row.id,seniorId:row.seniorId,action:row.action,status:row.status,dueDate:row.dueDate||row.date,legacy:true});}catch{/* Out of assignment. */}}
      return response({requests:requests.sort((a,b)=>Number(closed(a.status))-Number(closed(b.status))||a.dueDate.localeCompare(b.dueDate)),checkins:checkins.slice(0,100),legacy,canManage:staff,asOfDate});
    }
    if(path==='portal-care/requests'&&request.method==='POST'){
      const senior=await seniorFor(body?.seniorId);check(uuid(body.idempotencyKey),400,'Start a new follow-up request.');
      const prior=rows.find(row=>row.kind==='care_request'&&row.requestId===body.idempotencyKey);
      if(prior){check(prior.seniorId===senior.id&&prior.createdBy===actorId,409,'This request identifier has already been used.');return response({ok:true,request:clean(prior),replayed:true});}
      const entry=initialRequest(body,senior.id,body.idempotencyKey,new Date().toISOString());
      if(body.assignedTo){check(staff,403,'Only care staff can assign a follow-up.');const target=(await assignees(senior.id)).find(m=>m.userId===body.assignedTo);check(target||body.assignedTo===actorId,400,'Choose an assigned care staff account.');entry.assignedTo=body.assignedTo;entry.assignedToName=target?.name||session.name;}
      await write([event(db,owner,'care_request',senior.id,entry,entry.requestId)],senior.id,'followup_requested');
      return response({ok:true,request:clean(entry)},201);
    }
    const match=path.match(/^portal-care\/requests\/([a-f\d-]{36})$/iu);
    if(match&&request.method==='PATCH'){
      const current=requestState().find(row=>row.requestId===match[1]);check(current,404,'Follow-up not found.');await seniorFor(current.seniorId);
      check(Number.isInteger(body?.revision)&&body.revision===current.revision,409,'This follow-up changed. Refresh and try again.');
      check(!closed(current.status),409,'This follow-up is closed. Create a new request for a new concern.');
      const allowed=staff?['accepted','in_progress','completed','cancelled']:['acknowledged','reported_done'];check(allowed.includes(body.status),403,'Choose an action available to your account.');
      const reply=text(body.reply||'','Shared update',0,1600),outcome=text(body.outcome||'','Outcome',body.status==='completed'?5:0,1600);
      check(body.status!=='reported_done'||reply.length>=3,400,'Describe what you completed so your care team can review it.');
      const next={...clean(current),status:body.status,revision:current.revision+1,reply,outcome,updatedAt:new Date().toISOString(),actorId,actorName:session.name||session.role};
      if(staff&&body.assignedTo!==undefined){const target=(await assignees(current.seniorId)).find(m=>m.userId===body.assignedTo);check(target||body.assignedTo===actorId,400,'Choose an assigned care staff account.');next.assignedTo=body.assignedTo;next.assignedToName=target?.name||session.name;}
      // A revision-specific event id and database unique index prevent lost updates.
      const id=crypto.randomUUID();await write([event(db,owner,'care_request_state',current.seniorId,next,id)],current.seniorId,'followup_updated');
      return response({ok:true,request:clean(next)});
    }
    if(path==='checkins'&&request.method==='POST'){
      const senior=await seniorFor(body?.seniorId);check(uuid(body.idempotencyKey),400,'Start a new wellbeing check-in.');
      const prior=rows.find(row=>row.kind==='checkin'&&row.checkinId===body.idempotencyKey);
      if(prior){check(prior.seniorId===senior.id&&prior.reportedBy===actorId,409,'This check-in identifier has already been used.');return response({ok:true,checkin:prior,replayed:true});}
      const date=body.date||asOfDate;check(calendar(date)&&date<=asOfDate,400,'A check-in must use today or an earlier date.');check(!body.date||body.date===asOfDate||staff,403,'Members can record a check-in for the workspace’s current day.');
      let state={language:body.language||'en',step:0,answers:{}},result;
      for(let step=0;step<4;step++){const prompt=buildIvrPrompt(state),option=prompt.options.find(item=>item.value===body.answers?.[prompt.questionId]);check(option,400,'Answer all four wellbeing questions.');result=processIvrAnswer(state,option.digit);state=result.state;}
      const note=text(body.note||'','Additional note',0,1600),now=new Date().toISOString(),needsFollowup=result.callRequested||result.requiresHumanReview;
      const requestId=needsFollowup?crypto.randomUUID():null;
      const entry={checkinId:body.idempotencyKey,seniorId:senior.id,date,language:state.language,answers:state.answers,note,summary:result.note,reportedBy:actorId,reportedByRole:session.role,reportedByName:session.name||session.role,createdAt:now,requestId};
      const signal={type:'note',record:{seniorId:senior.id,date,note:`${session.role==='family'?'Family-reported wellbeing update. ':''}${result.note}${note?' Additional note: '+note:''}`,source:session.role==='family'?'family-message':`${session.role}-checkin`,checkinId:entry.checkinId,reportedByRole:session.role}};
      const events=[event(db,owner,'checkin',senior.id,entry,entry.checkinId),event(db,owner,'signal',senior.id,signal)];
      if(needsFollowup){const followup=initialRequest({action:result.helpRequested?'Contact senior about requested support':'Review wellbeing check-in',details:result.note,dueDate:date,priority:result.helpRequested?'prompt':'today'},senior.id,requestId,now);followup.checkinId=entry.checkinId;events.push(event(db,owner,'care_request',senior.id,followup,requestId));}
      await write(events,senior.id,'wellbeing_checkin_recorded');if(typeof onMutation==='function')await onMutation({kind:'signal',seniorId:senior.id,asOfDate,source:'wellbeing-checkin'});
      return response({ok:true,checkin:entry,followupCreated:needsFollowup},201);
    }
    return response({error:'This care action is not available.'},405);
  }catch(error){return response({error:error.status?error.message:'The care update could not be saved. Refresh and try again.'},error.status||500);}
}
