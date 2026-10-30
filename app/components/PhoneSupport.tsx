"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {careApi} from './AccessPortal';
import './phone-support.css';
import SmsCheckins from './SmsCheckins';

type SmsAnalysis={version:string;transport?:'sms'|'mms';urgency:'immediate'|'prompt'|'today';reasons:string[];cues:{cue:string;label:string;evidence:string}[];nextStep:string;classifier?:{available:boolean;modelId:string;label?:string;mode:string}};
type Request={id:string;seniorId:string|null;seniorName?:string;maskedSender:string;kind:'help'|'callback';status:'received'|'acknowledged'|'called'|'closed';message:string;receivedAt:string;createdAt:string;acknowledgedAt?:string;calledAt?:string;escalatedAt?:string;outcome?:string;smsStatus?:string;canRespond:boolean;delayed:boolean;analysis?:SmsAnalysis|null};
type Contact={name:string;role:string;phone:string;canCall:boolean;canSms:boolean};
type Contacts={seniorId:string;coordinator:Contact|null;operations:Contact|null;smsHelpline:string|null};
const errorText=(error:unknown)=>error instanceof Error?error.message:'Phone support could not be refreshed.';
const time=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'});
const labels={received:'Waiting for a response',acknowledged:'Acknowledged · callback pending',called:'Contact attempt recorded',closed:'Resolved'};

export function PhoneSupportNotice({onOpen}:{onOpen:()=>void}){
 const [pending,setPending]=useState(0),[unavailable,setUnavailable]=useState(false);
 useEffect(()=>{
  let active=true,running=false;
  async function refresh(){if(running)return;running=true;try{const result=await careApi<{requests:Request[]}>('/phone-intake');if(active){setPending(result.requests.filter(item=>item.status==='received'&&item.canRespond).length);setUnavailable(false);}}catch{if(active)setUnavailable(true);}finally{running=false;}}
  void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);
  return()=>{active=false;clearInterval(timer);};
 },[]);
 if(!pending&&!unavailable)return null;
 return <div className={`phone-support-notice${unavailable?' unavailable':''}`} role="status"><span>{unavailable?'Incoming phone requests could not be refreshed.':`${pending} phone ${pending===1?'request is':'requests are'} waiting for a response.`}</span><button type="button" onClick={onOpen}>Open phone support →</button></div>;
}

export function CarePhoneContact({seniorId,name}:{seniorId:string;name:string}){
 const [printing,setPrinting]=useState(false);
 const [resolved,setResolved]=useState<{seniorId:string;data?:Contacts;error?:string}|null>(null);
 const data=resolved?.seniorId===seniorId?resolved.data||null:null,error=resolved?.seniorId===seniorId?resolved.error||'':'';
 useEffect(()=>{let active=true;careApi<Contacts>(`/phone-intake/contact?seniorId=${encodeURIComponent(seniorId)}`).then(value=>{if(active)setResolved({seniorId,data:value});}).catch(reason=>{if(active)setResolved({seniorId,error:errorText(reason)});});return()=>{active=false;};},[seniorId]);
 const primary=data?.coordinator||data?.operations;
 function saveContact(helpline=false){
  const phone=helpline?data?.smsHelpline:primary?.phone;
  if(!phone)return;
  const label=helpline?'Samarth Care SMS helpline':`${primary?.role==='operations'?'Care operations':'Care coordinator'} - ${primary?.name||''}`;
  const escaped=label.replace(/[\r\n;,\\]/g,' ');
  const content=`BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${escaped}\r\nTEL;TYPE=CELL:${phone}\r\nEND:VCARD\r\n`;
  const url=URL.createObjectURL(new Blob([content],{type:'text/vcard;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=helpline?'Samarth-Care-SMS.vcf':'Care-coordinator.vcf';link.click();URL.revokeObjectURL(url);
 }
 function printCard(){setPrinting(true);window.addEventListener('afterprint',()=>setPrinting(false),{once:true});requestAnimationFrame(()=>window.print());}
 return <section className="care-phone-contact panel" data-print-card={printing||undefined} aria-label={`Care phone contact for ${name}`}>
  <div><span className="eyebrow">KEEP THESE CONTACTS HANDY</span><h2>Your care phone numbers</h2><p>Save these contacts on the senior’s phone. Calls and SMS work without opening this website.</p></div>
  {error?<p className="extension-error" role="alert">{error}</p>:!data?<p role="status">Loading the assigned contacts…</p>:<>
   {data.smsHelpline&&<div className="care-phone-number"><strong>Samarth Care SMS helpline</strong><span>{data.smsHelpline}</span><p>Text HELP for support or CALL for a callback. You can also describe a concern, such as “I fell today” or “tabiyat kharab hai”. Voice calls to this number are not automatically answered or forwarded.</p><div className="phone-support-actions"><a className="button primary" href={`sms:${data.smsHelpline}?body=HELP`}>Text HELP</a><a className="button secondary" href={`sms:${data.smsHelpline}?body=CALL`}>Request callback</a><button type="button" className="button secondary" onClick={()=>saveContact(true)}>Save SMS helpline</button></div></div>}
   {primary?<div className="care-phone-number"><strong>{primary.role==='operations'?'Care operations':'Your care coordinator'} · {primary.name}</strong><span>{primary.phone}</span><div className="phone-support-actions">{primary.canCall&&<a className="button primary" href={`tel:${primary.phone}`}>Call care team directly</a>}{primary.canSms&&!data.smsHelpline&&<a className="button secondary" href={`sms:${primary.phone}`}>Message care team directly</a>}<button type="button" className="button secondary" onClick={()=>saveContact()}>Save care-team contact</button></div></div>:<p className="phone-support-empty">Operations needs to add a confirmed care-team number and enable its call or SMS permission.</p>}
   {data?.operations&&primary?.phone!==data.operations.phone&&<p className="care-phone-fallback">Coordinator unavailable? {data.operations.canCall?<a href={`tel:${data.operations.phone}`}>Call Operations: {data.operations.phone}</a>:<span>Operations: {data.operations.phone}</span>}</p>}
   {(primary||data.smsHelpline)&&<div className="phone-support-actions"><button type="button" className="button secondary" onClick={printCard}>Print care card</button></div>}
  </>}
  <p className="care-phone-emergency">Immediate emergency in India: <a href="tel:112">Call 112</a>. Care callback requests do not dispatch emergency services.</p>
 </section>;
}

export default function PhoneSupport({seniors,notify,onChanged,onOpenFollowups}:{seniors:{id:string;name:string}[];notify:(message:string)=>void;onChanged?:()=>void|Promise<unknown>;onOpenFollowups?:()=>void}){
 const [tab,setTab]=useState<'requests'|'checkins'>('requests');
 const [requests,setRequests]=useState<Request[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(''),[checked,setChecked]=useState(''),[showClosed,setShowClosed]=useState(false),[closing,setClosing]=useState(''),[outcome,setOutcome]=useState(''),[dialLinks,setDialLinks]=useState<Record<string,string>>({}),[contactSenior,setContactSenior]=useState(seniors[0]?.id||'');
 const loading=useRef(false),acting=useRef(false);
 const refresh=useCallback(async()=>{if(loading.current)return;loading.current=true;try{const result=await careApi<{requests:Request[]}>('/phone-intake');setRequests(result.requests);setError('');setChecked(new Date().toISOString());}catch(reason){setError(errorText(reason));}finally{loading.current=false;}},[]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)return refresh();});const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);return()=>{active=false;clearInterval(timer);};},[refresh]);
 async function act(item:Request,action:'acknowledge'|'called'|'callback'|'close'){
  if(acting.current)return;acting.current=true;setBusy(item.id);
  try{
   const result=await careApi<{dialUri?:string}>(`/phone-intake/${item.id}/action`,'POST',{action,...(action==='close'?{outcome}: {})});
   if(action==='callback'){
    if(!/^tel:\+[1-9]\d{7,14}$/.test(result.dialUri||''))throw Error('The callback number is unavailable.');
    const uri=result.dialUri!;setDialLinks(previous=>({...previous,[item.id]:uri}));
    window.location.assign(uri);
   } else {
    if(action==='close'){setClosing('');setOutcome('');}
    notify(action==='acknowledge'?'Request acknowledged. Arrange the callback.':action==='called'?'Contact attempt recorded. Record the outcome when known.':'Phone request resolved.');
    await refresh();await onChanged?.();
   }
  }catch(reason){notify(errorText(reason));}finally{acting.current=false;setBusy('');}
 }
 const visible=requests.filter(item=>showClosed||item.status!=='closed').sort((a,b)=>Number(a.status==='closed')-Number(b.status==='closed')||Number(b.analysis?.urgency==='immediate')-Number(a.analysis?.urgency==='immediate')||Number(b.kind==='help')-Number(a.kind==='help')||Number(b.status==='received')-Number(a.status==='received')||a.createdAt.localeCompare(b.createdAt));
 const tabs=<nav className="phone-support-tabs" aria-label="Phone support tools"><button type="button" aria-pressed={tab==='requests'} onClick={()=>setTab('requests')}>Incoming help</button><button type="button" aria-pressed={tab==='checkins'} onClick={()=>setTab('checkins')}>SMS check-ins</button></nav>;
 if(tab==='checkins')return <div className="phone-support">{tabs}<SmsCheckins seniors={seniors} notify={notify} onChanged={onChanged} onOpenFollowups={onOpenFollowups}/></div>;
 return <div className="phone-support"><section className="page-intro"><div><span className="eyebrow">PHONE-FIRST CARE</span><h1>Incoming phone support</h1><p>Seniors can request a callback by ordinary SMS. No sign-in or website form is needed.</p></div><button className="button secondary" onClick={refresh}>Refresh</button></section>
  {tabs}<div className="phone-support-summary"><strong>{requests.filter(item=>item.status==='received').length} awaiting response</strong><span>{requests.filter(item=>item.status==='acknowledged').length} callback pending</span><small>{checked?`Last checked ${time(checked)}`:'Connecting to incoming requests…'}</small></div>
  <p className="phone-support-guidance">Seniors can send HELP / मदद, request a call in their own words, or describe a wellbeing concern. Text analysis highlights cues for human review. Unknown or shared numbers are reviewed by Operations.</p>
  {error&&<p className="extension-error" role="alert">{error}</p>}
  <label className="phone-support-toggle"><input type="checkbox" checked={showClosed} onChange={event=>setShowClosed(event.target.checked)}/> Include resolved requests</label>
  <div className="phone-support-list">{visible.map(item=><article className={`panel phone-support-request ${item.kind}`} key={item.id}>
   <div className="phone-support-request-heading"><div><span className="eyebrow">{item.kind==='help'?'HELP REQUEST':'CALLBACK REQUEST'} · {item.analysis?.transport==='mms'?'TEXT MMS':'SMS'}</span><h2>{item.seniorName||seniors.find(senior=>senior.id===item.seniorId)?.name||item.seniorId||'Caller needs matching'}</h2><p>{item.maskedSender} · Received {time(item.receivedAt)}</p></div><strong className={`phone-support-state ${item.status}`}>{labels[item.status]}</strong></div>
   {item.escalatedAt&&<p className="phone-support-escalated">Operations notified: a response was overdue.</p>}{item.delayed&&<p className="phone-support-escalated">This message reached the care system late. Check the received time when calling.</p>}
   {item.smsStatus&&<p className="phone-support-guidance">Care-team SMS: {item.smsStatus.replaceAll('_',' ')}. Delivery is separate from a human response.</p>}
   <blockquote>{item.message}</blockquote>{!item.seniorId&&<p className="phone-support-guidance">No senior’s records have been linked automatically. Confirm the caller’s identity during the callback.</p>}
   {item.analysis&&<section className="phone-support-analysis" aria-label="SMS text analysis"><h3>{item.analysis.urgency==='immediate'?'Contact promptly to verify this concern':item.analysis.urgency==='prompt'?'Support requested':'Callback and wellbeing review'}</h3><ul>{item.analysis.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>{item.analysis.cues.map(cue=><p key={cue.cue}><strong>{cue.label}:</strong> “{cue.evidence}”</p>)}<p>{item.analysis.nextStep}</p>{item.analysis.classifier?.available&&<p>Trained text model suggests: <strong>{({help:'support request',callback:'callback request',concern:'wellbeing concern',other:'no clear care request'} as Record<string,string>)[item.analysis.classifier.label||'']||'needs review'}</strong>. {item.analysis.classifier.mode==='shadow'?'Review-only suggestion; this model does not create alerts.':'The model can suggest a human callback review.'}</p>}<small>Automatic text analysis flags reported concerns. Confirm the meaning and who needs help during the callback.</small></section>}
   {item.outcome&&<p className="phone-support-outcome"><strong>Outcome:</strong> {item.outcome}</p>}
   {item.status!=='closed'&&(item.canRespond?<div className="phone-support-actions">{item.status==='received'&&<button className="button primary" disabled={!!busy} onClick={()=>act(item,'acknowledge')}>Take request</button>}<button className="button secondary" disabled={!!busy} onClick={()=>act(item,'callback')}>{busy===item.id?'Working…':'Call back'}</button>{item.status!=='called'&&<button className="button secondary" disabled={!!busy} onClick={()=>act(item,'called')}>Record contact attempt</button>}<button className="button secondary" disabled={!!busy} onClick={()=>{setClosing(item.id);setOutcome('');}}>Record outcome</button></div>:<p className="phone-support-guidance">The assigned coordinator or Operations can respond to this request.</p>)}
   {dialLinks[item.id]&&<p className="phone-support-guidance">Phone app did not open? <a href={dialLinks[item.id]}>Open callback number</a></p>}
   {closing===item.id&&<form className="phone-support-close" onSubmit={event=>{event.preventDefault();void act(item,'close');}}><label>What happened?<textarea required minLength={5} maxLength={1600} rows={3} value={outcome} disabled={!!busy} onChange={event=>setOutcome(event.target.value)}/></label><div className="phone-support-actions"><button className="button primary" disabled={!!busy}>Save outcome and resolve</button><button type="button" className="button secondary" disabled={!!busy} onClick={()=>setClosing('')}>Cancel</button></div></form>}
  </article>)}{!visible.length&&!error&&<p className="phone-support-empty panel">No incoming requests in this view. Keep the paired phone and receiver online to receive new SMS requests.</p>}</div>
  <section className="phone-support-contact-setup"><h2>Prepare the senior’s phone</h2><p>Save the SMS helpline and the assigned care-team contact during onboarding.</p><label>Senior<select value={contactSenior} onChange={event=>setContactSenior(event.target.value)}>{seniors.map(senior=><option key={senior.id} value={senior.id}>{senior.name}</option>)}</select></label>{contactSenior&&<CarePhoneContact seniorId={contactSenior} name={seniors.find(senior=>senior.id===contactSenior)?.name||contactSenior}/>}</section>
 </div>;
}
