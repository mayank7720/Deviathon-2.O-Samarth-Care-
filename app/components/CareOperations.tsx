"use client";

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {careApi} from './AccessPortal';
import './care-operations.css';

type StaffRole='counsellor'|'leader';
type CaseStatus='open'|'contact_attempted'|'contact_confirmed'|'escalated'|'resolved'|'cancelled';
type ContactChannel='phone'|'sms'|'in_app'|'in_person';
type ContactResult='no_answer'|'reached'|'failed';
type Senior={id:string;name:string;city:string;urgency?:string;score?:number|null};
type Staff={id:string;name:string;role:StaffRole;city:string;maxFamilies?:number};
type Assignment={seniorId:string;householdId:string;counsellorId:string;leaderId:string;backupId:string;source:'illustrative'|'recorded';counsellorName?:string;leaderName?:string;backupName?:string};
type History={revision?:number;status?:string;fromStatus?:string;toStatus?:string;note?:string;outcome?:string;actor?:string;actorName?:string;createdAt?:string;updatedAt?:string;at?:string;contactChannel?:string;contactResult?:string;escalationTarget?:string};
type CareCase={id:string;caseId:string;seniorId:string;revision:number;status:CaseStatus;category:string;action:string;note:string;assignedTo:string;contactChannel?:string;contactResult?:string;escalationTarget?:string;outcome?:string;createdAt?:string;updatedAt?:string;history:History[];historyComplete?:boolean};
type Snapshot={directory:Staff[];assignments:Assignment[];cases:CareCase[];notice:string;canManageAssignments:boolean};
type Props={data:{seniors:Senior[];session:{role:string;isAdmin?:boolean}};notify:(message:string)=>void;onChanged?:()=>void|Promise<void>;initialSenior?:string};
const labels:Record<CaseStatus,string>={open:'Open',contact_attempted:'Contact attempted',contact_confirmed:'Contact confirmed',escalated:'Escalated',resolved:'Resolved',cancelled:'Cancelled'};
const categoryLabels:Record<string,string>={wellbeing:'Wellbeing check-in',clinical_review:'Clinical review coordination',companionship:'Companionship',home_safety:'Home safety',daily_assistance:'Daily assistance'};
const channelLabels:Record<ContactChannel,string>={phone:'Phone call',sms:'SMS',in_app:'Care inbox',in_person:'In person'};
const resultLabels:Record<ContactResult,string>={no_answer:'No answer',reached:'Reached',failed:'Contact failed'};
const empty:Snapshot={directory:[],assignments:[],cases:[],notice:'',canManageAssignments:false};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value:'';
const list=(value:unknown)=>Array.isArray(value)?value:[];
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'The care update could not be completed.';
const stamp=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
function parseSnapshot(value:unknown):Snapshot {
  const source=object(value);
  const directory=list(source.directory).filter(item=>['counsellor','leader'].includes(text(object(item).role))).map(item=>{const row=object(item);return {id:text(row.id),name:text(row.name),role:row.role as StaffRole,city:text(row.city),...(typeof row.maxFamilies==='number'?{maxFamilies:row.maxFamilies}:{})};}).filter(row=>row.id&&row.name);
  const assignments=list(source.assignments).map(item=>{const row=object(item);return {seniorId:text(row.seniorId),householdId:text(row.householdId),counsellorId:text(row.counsellorId),leaderId:text(row.leaderId),backupId:text(row.backupId),source:row.source==='recorded'?'recorded':'illustrative',counsellorName:text(row.counsellorName),leaderName:text(row.leaderName),backupName:text(row.backupName)} as Assignment;}).filter(row=>row.seniorId);
  const cases=list(source.cases).filter(item=>{const row=object(item);return Object.hasOwn(labels,text(row.status))&&Number.isInteger(row.revision)&&Number(row.revision)>=1;}).map(item=>{const row=object(item),id=text(row.id)||text(row.caseId);return {id,caseId:text(row.caseId)||id,seniorId:text(row.seniorId),revision:row.revision as number,status:row.status as CaseStatus,category:text(row.category),action:text(row.action),note:text(row.note),assignedTo:text(row.assignedTo),contactChannel:text(row.contactChannel),contactResult:text(row.contactResult),escalationTarget:text(row.escalationTarget),outcome:text(row.outcome),createdAt:text(row.createdAt),updatedAt:text(row.updatedAt),historyComplete:typeof row.historyComplete==='boolean'?row.historyComplete:undefined,history:list(row.history).map(entry=>{const h=object(entry);return {revision:typeof h.revision==='number'?h.revision:undefined,status:text(h.status),fromStatus:text(h.fromStatus),toStatus:text(h.toStatus),note:text(h.note),outcome:text(h.outcome),actor:text(h.actor),actorName:text(h.actorName),createdAt:text(h.createdAt),updatedAt:text(h.updatedAt),at:text(h.at),contactChannel:text(h.contactChannel),contactResult:text(h.contactResult),escalationTarget:text(h.escalationTarget)};})};}).filter(row=>row.id&&row.seniorId);
  return {directory,assignments,cases,notice:text(source.notice),canManageAssignments:source.canManageAssignments===true};
}

function AssignmentEditor({senior,assignment,directory,onSaved}:{senior:Senior;assignment?:Assignment;directory:Staff[];onSaved:()=>Promise<void>}) {
  const [counsellorId,setCounsellor]=useState(assignment?.counsellorId||''),[leaderId,setLeader]=useState(assignment?.leaderId||''),[backupId,setBackup]=useState(assignment?.backupId||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const retry=useRef<{signature:string;id:string}|null>(null);
  const local=directory.filter(person=>person.city===senior.city),counsellors=local.filter(person=>person.role==='counsellor'),leaders=local.filter(person=>person.role==='leader');
  async function save(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');
    const signature=JSON.stringify({seniorId:senior.id,counsellorId,leaderId,backupId});
    if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
    try{await careApi('/care-operations/assignments','POST',{seniorId:senior.id,counsellorId,leaderId,backupId,idempotencyKey:retry.current.id});retry.current=null;await onSaved();}catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
  }
  return <details className="care-ops-edit"><summary>Record a care assignment</summary><form onSubmit={save}>
    <label>Primary counsellor<select required value={counsellorId} onChange={event=>setCounsellor(event.target.value)}><option value="">Choose a counsellor</option>{counsellors.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>Care-team leader<select required value={leaderId} onChange={event=>setLeader(event.target.value)}><option value="">Choose a leader</option>{leaders.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>Backup counsellor<select required value={backupId} onChange={event=>setBackup(event.target.value)}><option value="">Choose a different counsellor</option>{counsellors.filter(person=>person.id!==counsellorId).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <button className="button secondary" disabled={busy||!counsellorId||!leaderId||!backupId||backupId===counsellorId}>{busy?'Saving assignment…':'Save assignment'}</button>
    {error&&<p className="extension-error care-ops-form-error" role="alert">{error}</p>}
  </form><p className="care-ops-muted">This records ownership in the showcase. It does not notify a person or prove they have accepted a case.</p></details>;
}

function CreateCase({senior,directory,assignment,onSaved}:{senior:Senior;directory:Staff[];assignment?:Assignment;onSaved:()=>Promise<void>}) {
  const [category,setCategory]=useState('wellbeing'),[action,setAction]=useState(''),[note,setNote]=useState(''),[assignedTo,setAssignedTo]=useState(assignment?.counsellorId||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const retry=useRef<{signature:string;id:string}|null>(null);
  async function create(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');
    const values={seniorId:senior.id,category,action:action.trim(),note:note.trim(),assignedTo},signature=JSON.stringify(values);
    if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
    try{await careApi('/care-operations/cases','POST',{...values,idempotencyKey:retry.current.id});retry.current=null;setAction('');setNote('');await onSaved();}catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
  }
  return <section className="panel care-ops-create"><div className="care-ops-section-head"><span className="eyebrow">A SPECIFIC NEXT STEP</span><h2>Create a follow-up case</h2><p>Record what needs doing and who owns the next step. A case begins open until a coordinator documents an action.</p></div><form onSubmit={create}>
    <label>Support needed<select value={category} onChange={event=>setCategory(event.target.value)}>{Object.entries(categoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Case owner<select required value={assignedTo} onChange={event=>setAssignedTo(event.target.value)}><option value="">Choose a roster member</option>{directory.filter(person=>person.city===senior.city).map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label>
    <label className="care-ops-full">Next action<input required minLength={10} maxLength={300} value={action} onChange={event=>setAction(event.target.value)} placeholder="Describe the check-in or practical support to arrange"/></label>
    <label className="care-ops-full">Context for the care team<textarea required minLength={10} maxLength={1500} rows={3} value={note} onChange={event=>setNote(event.target.value)} placeholder="Record the reason and relevant context, using only showcase information"/></label>
    {error&&<p className="extension-error care-ops-form-error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy||action.trim().length<10||note.trim().length<10||!assignedTo}>{busy?'Creating case…':'Create open case'}</button>
  </form></section>;
}

function CaseUpdate({item,directory,city,onSaved}:{item:CareCase;directory:Staff[];city:string;onSaved:()=>Promise<void>}) {
  const [status,setStatus]=useState<CaseStatus>(item.status==='open'?'contact_attempted':item.status),[note,setNote]=useState(''),[channel,setChannel]=useState<ContactChannel>('phone'),[result,setResult]=useState<ContactResult|''>(''),[escalationTarget,setTarget]=useState(item.escalationTarget||''),[outcome,setOutcome]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const contact=status==='contact_attempted'||status==='contact_confirmed',terminal=item.status==='resolved'||item.status==='cancelled';
  const contactValid=!contact||Boolean(result&&(status==='contact_confirmed'?result==='reached':result!=='reached'));
  async function save(event:FormEvent){
    event.preventDefault();
    if(!contactValid){setError('Choose the actual contact result before saving this update.');return;}
    setBusy(true);setError('');
    try{await careApi(`/care-operations/cases/${encodeURIComponent(item.id)}`,'PATCH',{revision:item.revision,status,note:note.trim(),...(contact?{contactChannel:channel,contactResult:result}:{}),...(status==='escalated'?{escalationTarget}:{}),...(status==='resolved'?{outcome:outcome.trim()}:{})});await onSaved();}catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
  }
  if(terminal)return <p className="care-ops-closed-note">This case is {labels[item.status].toLowerCase()}. Its recorded history remains available.</p>;
  return <details className="care-ops-edit"><summary>Record the next case update</summary><form onSubmit={save}>
    <label>Recorded status<select value={status} onChange={event=>{setStatus(event.target.value as CaseStatus);setResult('');setError('');}}>{Object.entries(labels).filter(([value])=>value!=='open').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {contact&&<><label>Contact channel<select value={channel} onChange={event=>setChannel(event.target.value as ContactChannel)}>{Object.entries(channelLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Actual contact result<select required value={result} onChange={event=>setResult(event.target.value as ContactResult|'')}><option value="">Choose the actual result</option>{Object.entries(resultLabels).filter(([value])=>status==='contact_confirmed'?value==='reached':value!=='reached').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><p className="care-ops-form-help">{status==='contact_confirmed'?'Select “Reached” only after you personally confirmed contact.':'If you reached the person, choose “Contact confirmed” and explicitly record that result.'}</p></>}
    {status==='escalated'&&<label>Escalate to city leader<select required value={escalationTarget} onChange={event=>setTarget(event.target.value)}><option value="">Choose a leader</option>{directory.filter(person=>person.role==='leader'&&person.city===city).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
    <label className="care-ops-full">What happened?<textarea required minLength={10} maxLength={1500} rows={3} value={note} onChange={event=>setNote(event.target.value)} placeholder="Record the actual action or observation; do not assume a call connected"/></label>
    {status==='resolved'&&<label className="care-ops-full">Resolution outcome<textarea required minLength={5} maxLength={1500} rows={3} value={outcome} onChange={event=>setOutcome(event.target.value)} placeholder="Describe the support arranged and the agreed next step"/></label>}
    <p className="care-ops-form-help">Manual care-team record. Saving this update does not place a call, send a message or create a provider delivery receipt.</p>
    {error&&<p className="extension-error care-ops-form-error" role="alert">{error}</p>}
    <button className="button secondary" disabled={busy||!contactValid||note.trim().length<10||(status==='escalated'&&!escalationTarget)||(status==='resolved'&&outcome.trim().length<5)}>{busy?'Saving update…':'Save recorded update'}</button>
  </form></details>;
}

export default function CareOperations({data,notify,onChanged,initialSenior}:Props) {
  const [snapshot,setSnapshot]=useState<Snapshot>(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[choice,setChoice]=useState(initialSenior||''),[filter,setFilter]=useState('active');
  const selected=data.seniors.find(senior=>senior.id===choice)||data.seniors[0],canWrite=data.session.role==='coordinator'||data.session.role==='operations'&&data.session.isAdmin===true;
  useEffect(()=>{let active=true;careApi('/care-operations').then(result=>{if(active){setSnapshot(parseSnapshot(result));setError('');}}).catch(reason=>{if(active)setError(errorMessage(reason));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  async function refresh(){setLoading(true);try{setSnapshot(parseSnapshot(await careApi('/care-operations')));setError('');}catch(reason){setError(errorMessage(reason));}finally{setLoading(false);}}
  async function changed(){setSnapshot(parseSnapshot(await careApi('/care-operations')));await onChanged?.();notify('Care-team record saved. Ownership and case history have been refreshed.');}
  const assignment=snapshot.assignments.find(item=>item.seniorId===selected?.id),cases=snapshot.cases.filter(item=>item.seniorId===selected?.id);
  const staffName=(id?:string,fallback?:string)=>snapshot.directory.find(person=>person.id===id)?.name||fallback||'Not assigned';
  const activeCases=snapshot.cases.filter(item=>!['resolved','cancelled'].includes(item.status));
  const recorded=snapshot.assignments.filter(item=>item.source==='recorded');
  const cityRoster=snapshot.directory.filter(person=>person.city===selected?.city);
  const displayedCases=cases.filter(item=>filter==='all'||filter==='active'&&!['resolved','cancelled'].includes(item.status)||filter===item.status);
  return <>
    <section className="page-intro"><div><span className="eyebrow">PEOPLE, OWNERSHIP & THE NEXT STEP</span><h1>Care ownership & follow-ups</h1><p>See the named care owner, backup and escalation route. Document what actually happened, one case at a time.</p></div><button className="button secondary" onClick={refresh} disabled={loading}>Refresh care records</button></section>
    <div className="care-ops-notice"><strong>Fictional care-team roster</strong><p>{snapshot.notice||'These counsellors, leaders and planning assignments are illustrative showcase records. They are not actual Samarth staff or proof of a staffed care service.'}</p></div>
    <section className="care-ops-stats" aria-label="Recorded care operations"><article className="panel"><span>Open care cases</span><strong>{activeCases.length}</strong><small>Recorded, unfinished follow-ups</small></article><article className="panel"><span>Contact confirmed</span><strong>{snapshot.cases.filter(item=>item.status==='contact_confirmed').length}</strong><small>Manual coordinator records</small></article><article className="panel"><span>Escalations open</span><strong>{snapshot.cases.filter(item=>item.status==='escalated').length}</strong><small>Awaiting a recorded next step</small></article><article className="panel"><span>Resolved cases</span><strong>{snapshot.cases.filter(item=>item.status==='resolved').length}</strong><small>Coordinator-recorded outcomes</small></article><article className="panel"><span>Recorded ownership</span><strong>{recorded.length}</strong><small>{snapshot.assignments.length-recorded.length} illustrative planning assignments</small></article></section>
    {error&&<p className="extension-error" role="alert">{error}</p>}
    <section className="panel care-ops-selection"><label>Senior and household<select value={selected?.id||''} onChange={event=>setChoice(event.target.value)}>{data.seniors.map(senior=><option key={senior.id} value={senior.id}>{senior.name} · {senior.city} · {senior.id}</option>)}</select></label><div>{selected?<><strong>{selected.city}</strong><span>{assignment?.householdId?`Household ${assignment.householdId}`:'Household assignment not recorded'}</span></>:<span>No assigned seniors are available.</span>}</div></section>
    {loading?<section className="panel care-ops-empty">Loading care ownership and case history…</section>:selected&&<>
      <section className="panel care-ops-ownership"><header className="care-ops-title-row"><div><span className="eyebrow">{selected.name}</span><h2>Who owns the next step?</h2></div><span className={`care-ops-source ${assignment?.source||'unassigned'}`}>{assignment?assignment.source==='recorded'?'Recorded assignment':'Illustrative planning':'Not assigned'}</span></header><div className="care-ops-owner-grid">{[{role:'Primary counsellor',id:assignment?.counsellorId,name:assignment?.counsellorName,detail:'Owns the household’s day-to-day follow-up.'},{role:'Care-team leader',id:assignment?.leaderId,name:assignment?.leaderName,detail:'Receives escalations and coordinates support.'},{role:'Backup counsellor',id:assignment?.backupId,name:assignment?.backupName,detail:'Provides continuity when the primary owner is unavailable.'}].map(owner=><article key={owner.role}><span>{owner.role}</span><h3>{staffName(owner.id,owner.name)}</h3><p>{owner.detail}</p></article>)}</div>{canWrite&&snapshot.canManageAssignments?<AssignmentEditor key={`${selected.id}:${assignment?.counsellorId}:${assignment?.leaderId}:${assignment?.backupId}:${assignment?.source}`} senior={selected} assignment={assignment} directory={snapshot.directory} onSaved={changed}/>:<p className="care-ops-muted">Workspace administrators manage care assignments. Coordinators record care case updates.</p>}</section>
      <div className="care-ops-work-grid"><section className="care-ops-cases"><header className="care-ops-title-row"><div><span className="eyebrow">RECORDED WORK</span><h2>Follow-up cases</h2></div><label className="care-ops-filter">Show<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="active">Active cases</option><option value="all">All recorded cases</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></header>{!displayedCases.length?<article className="panel care-ops-empty"><h3>No {filter==='active'?'active ':''}cases recorded</h3><p>{cases.length?'Change the filter to inspect recorded case history.':'No contact attempt, escalation or outcome has been invented for this senior. Create a case when a specific action is needed.'}</p></article>:displayedCases.map(item=><article className="panel care-ops-case" key={item.id}><header className="care-ops-title-row"><div><span className="eyebrow">{categoryLabels[item.category]||item.category||'Care follow-up'}</span><h3>{item.action||'Recorded care case'}</h3></div><span className={`care-ops-case-status ${item.status}`}>{labels[item.status]}</span></header><p className="care-ops-case-note">{item.note||'No context note was recorded.'}</p><dl><div><dt>Case owner</dt><dd>{staffName(item.assignedTo)}</dd></div><div><dt>Last update</dt><dd>{stamp(item.updatedAt||item.createdAt)}</dd></div>{item.contactChannel&&<div><dt>Recorded contact</dt><dd>{channelLabels[item.contactChannel as ContactChannel]||item.contactChannel} · {resultLabels[item.contactResult as ContactResult]||item.contactResult||'Result not recorded'}</dd></div>}{item.escalationTarget&&<div><dt>Escalation owner</dt><dd>{staffName(item.escalationTarget)}</dd></div>}</dl>{item.outcome&&<div className="care-ops-outcome"><strong>Recorded outcome</strong><p>{item.outcome}</p></div>}{item.historyComplete===false&&<p className="care-ops-history-warning">Earlier updates are missing from this view. The available entries do not form a complete case history.</p>}<details className="care-ops-history"><summary>Available case history ({item.history.length})</summary>{item.history.length?<ol>{item.history.map((entry,index)=><li key={`${entry.revision??index}:${entry.at||entry.createdAt||index}`}><div><strong>{labels[(entry.toStatus||entry.status) as CaseStatus]||entry.toStatus||entry.status||'Recorded update'}</strong><time>{stamp(entry.at||entry.createdAt||entry.updatedAt)}</time></div>{(entry.actorName||entry.actor)&&<span>{entry.actorName||entry.actor}</span>}<p>{entry.note||entry.outcome||'No additional note was recorded.'}</p></li>)}</ol>:<p>No history entries are available for this record.</p>}</details>{canWrite&&<CaseUpdate key={`${item.id}:${item.revision}`} item={item} directory={snapshot.directory} city={selected.city} onSaved={changed}/>}</article>)}</section>{canWrite?<CreateCase key={`${selected.id}:${assignment?.counsellorId}`} senior={selected} directory={snapshot.directory} assignment={assignment} onSaved={changed}/>:<aside className="panel care-ops-readonly"><span className="eyebrow">OPERATIONS VIEW</span><h2>Inspect what the team recorded</h2><p>Contact status comes from manual case updates. This page does not confirm a carrier connection, message delivery or that a family received support.</p></aside>}</div>
      <section className="panel care-ops-roster"><div className="care-ops-section-head"><span className="eyebrow">{selected.city} · FICTIONAL PLANNING ROSTER</span><h2>Care coverage & capacity</h2><p>The family allocation is an illustrative planning limit. It is not a measured staffing promise or evidence of an available real-world service.</p></div><div className="care-ops-table-wrap"><table><thead><tr><th>Roster member</th><th>Role</th><th>Primary households</th><th>Planning limit</th></tr></thead><tbody>{cityRoster.map(person=>{const households=new Set(snapshot.assignments.filter(item=>item.counsellorId===person.id||person.role==='leader'&&item.leaderId===person.id).map(item=>item.householdId||item.seniorId));return <tr key={person.id}><td><strong>{person.name}</strong><small>{person.city}</small></td><td>{person.role==='leader'?'Care-team leader':'Counsellor'}</td><td>{households.size}</td><td>{person.role==='counsellor'&&person.maxFamilies?`${person.maxFamilies} families · illustrative`:'Not specified'}</td></tr>;})}</tbody></table>{!cityRoster.length&&<p className="care-ops-muted">No roster entries are available for this city.</p>}</div></section>
    </>}
  </>;
}
