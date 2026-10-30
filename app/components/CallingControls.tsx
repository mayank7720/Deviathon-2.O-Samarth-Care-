"use client";
import {useState} from 'react';
import {careApi} from './AccessPortal';
type Policy={callsEnabled:boolean;restrictHours:boolean;start:string;end:string;helpOutsideHours:boolean};
export default function CallingControls({policy,revision,isAdmin,onSaved,notify}:{policy:Policy;revision:number;isAdmin:boolean;onSaved:()=>Promise<void>;notify:(text:string)=>void}){
 const [draft,setDraft]=useState(policy),[busy,setBusy]=useState(false);
 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);try{await careApi('/telephony/automation/policy','POST',{revision,...draft});await onSaved();notify('Calling access and hours saved. Every new dispatch uses the current cloud controls.');}catch(e){notify(e instanceof Error?e.message:'Calling controls could not be saved.');await onSaved();}finally{setBusy(false);}}
 return <section className="panel automation-settings"><h3>Calling controls</h3><p><strong>{policy.callsEnabled?'New bot calls allowed':'All new bot calls paused'}</strong> · {policy.restrictHours?`${policy.start}–${policy.end} IST${policy.start>policy.end?' (overnight)':''}`:'All-day access'}{policy.helpOutsideHours&&policy.restrictHours?' · HELP callbacks can run outside routine hours':''}</p>{isAdmin?<form onSubmit={save}>
  <label className="automation-check"><input type="checkbox" checked={draft.callsEnabled} onChange={e=>setDraft({...draft,callsEnabled:e.target.checked})}/> Allow new bot calls</label>
  <label className="automation-check"><input type="checkbox" checked={draft.restrictHours} onChange={e=>setDraft({...draft,restrictHours:e.target.checked})}/> Restrict calls to an agreed daily window</label>
  {draft.restrictHours&&<div className="automation-form-row"><label>Start time · IST<input type="time" required value={draft.start} onChange={e=>setDraft({...draft,start:e.target.value})}/></label><label>End time · IST<input type="time" required value={draft.end} onChange={e=>setDraft({...draft,end:e.target.value})}/></label></div>}
  {draft.restrictHours&&<label className="automation-check"><input type="checkbox" checked={draft.helpOutsideHours} onChange={e=>setDraft({...draft,helpOutsideHours:e.target.checked})}/> Allow HELP callbacks and their coordinator briefings outside routine hours</label>}
  <p>These controls apply to staff-started and automatic calls. All-day access removes the daily time window; it does not enable a senior’s automation or bypass consent, trial restrictions or the remaining allowance. Pausing blocks new dispatches; a call already accepted by the carrier can finish.</p>
  <button className="button primary" disabled={busy||draft.restrictHours&&draft.start===draft.end}>{busy?'Saving…':'Save calling controls'}</button>
 </form>:<p>Operations manages these controls. Your assigned account numbers determine the recipients.</p>}</section>;
}
