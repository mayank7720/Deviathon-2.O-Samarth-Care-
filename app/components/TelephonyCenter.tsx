"use client";

import React,{useEffect,useRef,useState} from 'react';
import {careApi} from './AccessPortal';
import SimCalls from './SimCalls';
import './telephony-center.css';

type Contact={id:string;seniorId:string;userId?:string;name?:string;role:'senior'|'family'|'coordinator'|'operations';maskedPhone:string;verified:boolean;smsConsent:boolean;callConsent:boolean;allowedTemplates?:string[]};
type Job={id:string;seniorId:string;contactId:string;recipientRole:string;channel:'sms'|'android_dialer'|'voice_bot';language:string;template:string;status:string;createdAt:string;updatedAt?:string;externalDelivery:boolean;deliveredToHandset:boolean;humanRead:boolean;lastError?:string};
type Config={contacts:Contact[];androidBridgeConfigured:boolean;androidOnline:boolean;androidLastSeenAt?:string;voiceBotConfigured:boolean;billingNotice:string;voiceBotNotice:string};
type RoutedNotice={id:string;seniorId:string;recipientRole:string;recipientName?:string;kind:string;status:string;jobId?:string;createdAt:string;lastError?:string};
type Props={data:{seniors?:{id:string;name:string}[];session:{role:string;isAdmin?:boolean}};notify:(message:string)=>void};
const message=(error:unknown)=>error instanceof Error?error.message:'The telephone action could not finish.';
const time=(value?:string)=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
const statusLabel=(value:string)=>({queued:'Queued for device',processing:'Device claimed request',accepted:'Gateway accepted',sent:'Carrier accepted SMS',delivered:'Delivery report received',awaiting_device_action:'Press Call on the phone',failed:'Device reported failure',cancelled:'Cancelled',expired:'Expired'}[value]||value.replaceAll('_',' '));
const roleLabels:Record<string,string>={senior:'Senior member',family:'Family member',coordinator:'Care coordinator',operations:'Operations manager'};
const templateLabels:Record<string,string>={checkin:'Ask the senior for a wellbeing update',followup:'Arrange a care-team call',serious_alert:'Ask for prompt care-team contact',support_request:'Notify the coordinator of a support request',staff_alert:'Notify the coordinator of a review alert',care_message:'Ask care staff to review a message',escalation:'Notify Operations of an escalation'};
const fallbackTemplates:Record<string,string[]>={senior:['checkin','followup','serious_alert'],family:['followup','serious_alert'],coordinator:['support_request','staff_alert','care_message'],operations:['escalation','care_message']};
const routingLabel=(value:string)=>({pending:'Finding the assigned recipient',awaiting_contact:'Waiting for a confirmed SMS number',queued:'SMS queued for the device',cooldown:'Held to avoid repeated messages',blocked_access:'Blocked: access or consent changed',expired:'No longer due',accepted:'Gateway accepted',sent:'Carrier accepted SMS',delivered:'Handset delivery confirmed',failed:'Delivery failed',cancelled:'Cancelled'}[value]||value.replaceAll('_',' '));

function TelephonyWorkspace({data,notify}:Props){
  const [config,setConfig]=useState<Config|null>(null),[jobs,setJobs]=useState<Job[]>([]),[routed,setRouted]=useState<RoutedNotice[]>([]),[routingError,setRoutingError]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const [contactId,setContactId]=useState(''),[channel,setChannel]=useState<'sms'|'android_dialer'|'voice_bot'>('sms'),[template,setTemplate]=useState('checkin'),[language,setLanguage]=useState('hi'),[consent,setConsent]=useState(false);
  const [dialLinks,setDialLinks]=useState<Record<string,string>>({});
  const requestKey=useRef<{fingerprint:string;id:string}|null>(null),queueActive=useRef(false);
  const canWrite=data.session.role==='coordinator'||data.session.role==='operations'&&data.session.isAdmin===true,selected=config?.contacts.find(c=>c.id===contactId);
  const permitted=selected?.verified&&(channel==='sms'?selected.smsConsent:selected.callConsent);
  const templates=selected?.allowedTemplates||fallbackTemplates[selected?.role||'']||[],selectedTemplate=templates.includes(template)?template:templates[0]||'';
  const name=(seniorId:string)=>data.seniors?.find(s=>s.id===seniorId)?.name||seniorId;
  async function refresh(){
    try{const [configuration,history]=await Promise.all([careApi('/telephony/config'),careApi('/telephony/jobs')]);setConfig(configuration);setJobs(history.jobs||[]);setError('');}
    catch(reason){setError(message(reason));}
    try{const routing=await careApi('/telephony/routing');setRouted(routing.routes||[]);setRoutingError('');}catch{setRoutingError('Routing history could not be loaded. Refresh to try again.');}
  }
  useEffect(()=>{void Promise.resolve().then(refresh);const interval=setInterval(refresh,15000);return()=>clearInterval(interval);},[]);
  async function queue(event:React.FormEvent){
    event.preventDefault();if(queueActive.current||!canWrite||!permitted||!consent)return;
    const fingerprint=JSON.stringify([contactId,channel,selectedTemplate,language]);
    if(requestKey.current?.fingerprint!==fingerprint)requestKey.current={fingerprint,id:crypto.randomUUID()};
    queueActive.current=true;setBusy('queue');
    try{
      const result=await careApi('/telephony/jobs','POST',{contactId,channel,template:selectedTemplate,language,idempotencyKey:requestKey.current.id,consentConfirmed:consent});
      requestKey.current=null;setConsent(false);await refresh();notify(result.notice||'The assigned device request is queued.');
    }catch(reason){notify(message(reason));}finally{queueActive.current=false;setBusy('');}
  }
  async function cancel(id:string){setBusy(id);try{await careApi(`/telephony/jobs/${id}/cancel`,'POST',{});await refresh();notify('Queued request cancelled.');}catch(reason){notify(message(reason));}finally{setBusy('');}}
  async function startVoice(id:string){setBusy(id);try{await careApi(`/telephony/jobs/${id}/start`,'POST',{});await refresh();notify('The trial provider accepted the request. Signed callbacks will record ringing and answers.');}catch(reason){notify(message(reason));}finally{setBusy('');}}
  async function prepareDial(id:string){
    setBusy(id);try{
      const result=await careApi(`/telephony/jobs/${id}/dial`,'POST',{});
      if(!/^tel:\+[1-9]\d{7,14}$/.test(result.dialUri||''))throw new Error('The phone action returned an invalid destination.');
      setDialLinks(previous=>({...previous,[id]:result.dialUri}));await refresh();notify('Open the phone app below, then press Call on your device.');
    }catch(reason){notify(message(reason));}finally{setBusy('');}
  }
  return <div className="telephony-center">
    <section className="page-intro"><div><span className="eyebrow">COMMUNICATIONS</span><h1>Calls &amp; SMS</h1><p>Contact assigned account holders and track delivery.</p></div><button className="button secondary" onClick={refresh}>Refresh device &amp; jobs</button></section>
    {error&&<p className="extension-error" role="alert">{error}</p>}
    <section className="telephony-status panel">
      <div><span className="eyebrow">PAIRED ANDROID</span><h2>{config?.androidOnline?'Device connected':config?.androidBridgeConfigured?'Waiting for the device relay':'Pairing required'}</h2><p>Last verified device contact: {time(config?.androidLastSeenAt)}</p></div>
      <div className="telephony-evidence"><strong>What the statuses mean</strong><p>Queued is waiting. Sent means the carrier accepted the SMS. Delivered requires a handset delivery report. None means a person read it or a coordinator responded.</p></div>
    </section>
    <section className="telephony-layout">
      <div className="panel telephony-compose"><span className="eyebrow">RECIPIENT</span><h2>Request a message or call</h2>
        <p>Choose the person who should receive the message. Sending uses the paired SIM or configured provider.</p>
        {canWrite?<form onSubmit={queue}>
          <label>Receiving account<select required value={contactId} onChange={event=>{setContactId(event.target.value);setConsent(false);setChannel('sms');}}><option value="">Choose an account contact</option>{config?.contacts.map(contact=><option key={contact.id} value={contact.id}>{contact.name||roleLabels[contact.role]} · {roleLabels[contact.role]} · {name(contact.seniorId)} · {contact.maskedPhone}</option>)}</select></label>
          {!config?.contacts.length&&<p className="telephony-muted">No mobile numbers are assigned. The administrator can add them under Accounts.</p>}
          <div className="telephony-form-row"><label>Channel<select value={channel} onChange={event=>{setChannel(event.target.value as 'sms'|'android_dialer'|'voice_bot');setConsent(false);}}><option value="sms">SMS through paired SIM</option><option value="android_dialer">Assisted phone call</option>{config?.voiceBotConfigured&&selected?.role==='senior'&&<option value="voice_bot">Hindi/English senior check-in bot</option>}</select></label><label>Language<select value={language} onChange={event=>setLanguage(event.target.value)}><option value="hi">हिन्दी</option><option value="en">English</option></select></label></div>
          <label>Message purpose<select required value={selectedTemplate} disabled={!selected} onChange={event=>{setTemplate(event.target.value);setConsent(false);}}>{!templates.length&&<option value="">Choose a recipient first</option>}{templates.map(value=><option key={value} value={value}>{templateLabels[value]||value.replaceAll('_',' ')}</option>)}</select></label>
          {selected&&!permitted&&<p className="extension-error">This contact still needs verified consent for the selected channel.</p>}
          <label className="telephony-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} required/><span>The owner of this approved destination agreed to this message or call.</span></label>
          <button className="button primary" disabled={!!busy||!permitted||!consent||!selectedTemplate}>{busy==='queue'?'Saving request…':channel==='sms'?'Queue SMS to recipient':channel==='voice_bot'?'Queue senior check-in call':'Prepare an assisted call'}</button>
        </form>:<p className="telephony-muted">A coordinator can request communications. Your role can inspect recorded delivery outcomes.</p>}
        <p className="telephony-small">{config?.billingNotice||'Your existing SIM plan and carrier limits apply. The local relay adds no SMS API vendor fee.'} Saving a receiving number does not change the caller ID or place an automatic call.</p>
      </div>
    </section>
    <section className="panel telephony-history"><div className="telephony-history-heading"><div><span className="eyebrow">DELIVERY HISTORY</span><h2>Recent requests</h2></div><span>{jobs.length} recorded</span></div>
      {!jobs.length?<p className="telephony-muted">No telephone request is recorded. Choose an account contact to begin.</p>:<div className="telephony-job-list">{jobs.map(job=><article key={job.id} className="telephony-job"><div><span className="eyebrow">{job.channel==='sms'?'SMS':job.channel==='voice_bot'?'VOICE BOT':'ASSISTED CALL'} · {job.language==='hi'?'हिन्दी':'English'}</span><h3>{name(job.seniorId)}</h3><p>{job.recipientRole} · {time(job.createdAt)}</p><span className={`telephony-badge ${job.status}`}>{statusLabel(job.status)}</span>{job.lastError&&<p className="extension-error">{job.lastError}</p>}</div><div className="telephony-job-actions">{canWrite&&job.status==='queued'&&<>{job.channel==='voice_bot'&&<button className="button primary" disabled={!!busy} onClick={()=>startVoice(job.id)}>Start credited call</button>}{job.channel==='android_dialer'&&<button className="button primary" disabled={!!busy} onClick={()=>prepareDial(job.id)}>Get approved phone action</button>}<button className="button secondary" disabled={!!busy} onClick={()=>cancel(job.id)}>Cancel queued request</button></>}{dialLinks[job.id]&&<a className="button primary" href={dialLinks[job.id]}>Open phone app</a>}<small>{job.deliveredToHandset?'Handset report recorded':job.externalDelivery?'Carrier accepted; delivery report pending':'No completed telephone delivery claimed'}</small></div></article>)}</div>}
    </section>
    <section className="panel telephony-routing"><div className="telephony-history-heading"><div><span className="eyebrow">AUTOMATIC CARE ROUTING</span><h2>Who receives each care update</h2></div><span>{routed.length} recorded</span></div><p className="telephony-muted">Support and call requests notify assigned care staff. A request for a call does not automatically dial the senior. Family notices depend on sharing consent; Operations receives escalations.</p>{routingError&&<p className="extension-error" role="alert">{routingError}</p>}{!routed.length&&!routingError?<p className="telephony-muted">No routed notices are recorded yet. New care requests and eligible alerts appear here.</p>:<div className="telephony-routing-list">{routed.map(route=><article key={route.id}><div><strong>{route.recipientName||roleLabels[route.recipientRole]||'Assigned care team'}</strong><span>{roleLabels[route.recipientRole]||route.recipientRole} · {name(route.seniorId)}</span><small>{templateLabels[route.kind]||route.kind.replaceAll('_',' ')} · {time(route.createdAt)}</small></div><div><span className={`telephony-badge ${route.status}`}>{routingLabel(route.status)}</span>{route.lastError&&<p className="extension-error">{route.lastError}</p>}</div></article>)}</div>}</section>
    <SimCalls data={data} contacts={config?.contacts||[]} notify={notify}/>
  </div>;
}

export default function TelephonyCenter(props:Props){
  if(!['coordinator','operations'].includes(props.data.session.role))return <p className="extension-error">Calls and SMS delivery records are available only to the assigned care team.</p>;
  return <TelephonyWorkspace {...props}/>;
}
