"use client";

import React,{useEffect,useRef,useState} from 'react';
import {careApi} from './AccessPortal';
import './sim-calls.css';

export type SimContact={id:string;seniorId:string;role:string;maskedPhone:string;verified:boolean;callConsent:boolean};
type SimJob={id:string;seniorId:string;status:string;language:string;createdAt:string;callAnswered:boolean;consentGranted:boolean;audioCount:number;humanRead:boolean};
type BridgeStatus={enabled:boolean;bridgeOnline:boolean;lastSeenAt?:string|null;notice:string};
type Props={data:{seniors?:{id:string;name:string}[];session:{role:string;isAdmin?:boolean}};contacts:SimContact[];notify:(message:string)=>void};
const text=(reason:unknown)=>reason instanceof Error?reason.message:'The SIM call service could not be read.';
const date=(value?:string|null)=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'No device check recorded';
const label=(status:string)=>({queued:'Queued; no call yet',claimed:'Worker reserved this call',originated:'Call command accepted; answer unconfirmed',answers_recorded:'Four consented answers recorded',declined:'Recording permission declined',disconnected:'Call disconnected',failed:'Device reported a failure',submission_unknown:'Submission uncertain — inspect before another call'}[status]||status.replaceAll('_',' '));

function SimCallWorkspace({data,contacts,notify}:Props){
  const [status,setStatus]=useState<BridgeStatus|null>(null),[jobs,setJobs]=useState<SimJob[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [contactId,setContactId]=useState(''),[language,setLanguage]=useState<'hi'|'en'>('hi'),[consent,setConsent]=useState(false);
  const pendingRequest=useRef<{fingerprint:string;id:string}|null>(null),inFlight=useRef(false);
  const canWrite=(data.session.role==='coordinator'||data.session.role==='operations'&&data.session.isAdmin===true),approved=contacts.filter(contact=>contact.verified&&contact.callConsent),selected=approved.find(contact=>contact.id===contactId);
  const name=(id:string)=>data.seniors?.find(senior=>senior.id===id)?.name||id;
  async function refresh(){
    try{
      const [bridge,history]=await Promise.all([careApi('/sim-calls/status'),careApi('/sim-calls/jobs')]);
      if(typeof bridge.enabled!=='boolean'||typeof bridge.bridgeOnline!=='boolean'||!Array.isArray(history.jobs))throw new Error('The call bridge returned an incomplete status.');
      setStatus(bridge);setJobs(history.jobs);setError('');
    }catch(reason){setError(text(reason));}finally{setLoading(false);}
  }
  useEffect(()=>{let active=true;const update=async()=>{if(active)await refresh();};void update();const timer=setInterval(update,20000);return()=>{active=false;clearInterval(timer);};},[]);
  async function queue(event:React.FormEvent){
    event.preventDefault();if(inFlight.current||!canWrite||!selected||!consent||!status?.enabled||!status.bridgeOnline)return;
    const fingerprint=JSON.stringify([contactId,language]);
    if(pendingRequest.current?.fingerprint!==fingerprint)pendingRequest.current={fingerprint,id:crypto.randomUUID()};
    inFlight.current=true;setBusy(true);
    try{
      const result=await careApi('/sim-calls/jobs','POST',{contactId,language,consentConfirmed:true,idempotencyKey:pendingRequest.current.id});
      pendingRequest.current=null;setConsent(false);await refresh();notify(result.notice||'SIM call queued. No answered call is claimed.');
    }catch(reason){setError(text(reason));notify(text(reason));}finally{inFlight.current=false;setBusy(false);}
  }
  return <section className="sim-calls panel" aria-labelledby="sim-calls-title">
    <div className="sim-calls-heading"><div><span className="eyebrow">OPTIONAL OWN-SIM VOICE BRIDGE</span><h2 id="sim-calls-title">Hindi / English voice check-in</h2><p>Four short wellbeing questions over a normal phone call, with recording permission before the first answer.</p></div><button className="button secondary" onClick={refresh} disabled={busy}>Refresh call bridge</button></div>
    <div className={`sim-bridge-state ${status?.bridgeOnline?'ready':''}`} role="status"><strong>{loading?'Checking bridge status…':status?.bridgeOnline?'Linux phone bridge connected':status?.enabled?'Waiting for the Linux phone bridge':'Prepared; live SIM bot disabled'}</strong><span>{date(status?.lastSeenAt)}</span></div>
    {error&&<p className="extension-error" role="alert">{error}</p>}
    <div className="sim-calls-layout"><div>
      {canWrite?<form className="sim-call-form" onSubmit={queue}>
        <label>Approved call destination<select value={contactId} onChange={event=>{setContactId(event.target.value);setConsent(false);}} disabled={busy}><option value="">Choose an approved contact</option>{approved.map(contact=><option key={contact.id} value={contact.id}>{name(contact.seniorId)} · {contact.role} · {contact.maskedPhone}</option>)}</select></label>
        {!approved.length&&<p className="telephony-muted">Approve a number you control with call permission above before requesting a check-in.</p>}
        <label>Spoken questions<select value={language} onChange={event=>setLanguage(event.target.value as 'hi'|'en')} disabled={busy}><option value="hi">हिन्दी</option><option value="en">English</option></select></label>
        <label className="sim-call-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} disabled={busy}/><span>The destination owner agrees to this call. The bot must also ask for recording permission on the call.</span></label>
        <button className="button primary" disabled={busy||!selected||!consent||!status?.enabled||!status.bridgeOnline}>{busy?'Saving one call request…':'Queue consented voice check-in'}</button>
        {!status?.bridgeOnline&&<p className="sim-call-help">Live requests stay unavailable until a prepared Linux bridge reports ready. Your Android SMS relay can be used separately.</p>}
      </form>:<p className="telephony-muted">Operations can inspect the call evidence. An assigned coordinator must request a call.</p>}
    </div><div className="sim-call-boundary"><h3>What must be connected</h3><p>A Linux computer, Asterisk with Bluetooth mobile support, the paired SIM phone, spoken prompts and verified two-way audio. These bridge files are prepared; this Windows laptop has no Linux bridge running.</p><p>No calling API vendor fee is added. Your SIM plan, carrier charges and limits apply. n8n orchestration does not include telephone minutes.</p><p>A call command is not an answered call. Saved audio is transcribed locally into drafts; a coordinator must review the words before they become care notes.</p></div></div>
    <div className="sim-call-history"><h3>SIM voice evidence</h3>{!jobs.length?<p className="telephony-muted">No SIM bot calls are recorded. No test call has been placed by this setup.</p>:jobs.map(job=><article className="sim-call-record" key={job.id}><div><strong>{name(job.seniorId)}</strong><p>{job.language==='hi'?'हिन्दी':'English'} · {date(job.createdAt)}</p><span className={`sim-call-label ${job.status==='submission_unknown'?'uncertain':''}`}>{label(job.status)}</span></div><p className="sim-call-proof">{job.callAnswered?'Answered-channel evidence recorded':'Answer not established'}<br/>{job.consentGranted?'Recording permission recorded':'Recording permission not established'}<br/>{job.audioCount||0} audio answers · human follow-up still requires its own care record</p></article>)}</div>
  </section>;
}

export default function SimCalls(props:Props){
  if(!['coordinator','operations'].includes(props.data.session.role))return null;
  return <SimCallWorkspace {...props}/>;
}
