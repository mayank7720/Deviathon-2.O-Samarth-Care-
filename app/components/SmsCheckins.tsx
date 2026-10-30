"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {careApi} from './AccessPortal';
import './sms-checkins.css';
type Checkin={id:string;seniorId:string;seniorName:string;code:string;prompt:string;maskedPhone:string;requiresCode:boolean;sendAt:string;dueAt:string;createdAt:string;deliveryStatus:string;receiptAt:string|null;answer:'1'|'2'|'3'|null;answeredAt:string|null;overdueAt:string|null;followupId:string|null;overdueTaskId:string|null;reviewTaskId:string|null;reviewedAt:string|null;outcome:string|null};
type ReviewReply={id:string;maskedSender:string;message:string;receivedAt:string;resolution:string;reviewedAt:string|null;outcome:string|null};
type State={checkins:Checkin[];reviewReplies:ReviewReply[];contacts:{seniorId:string;maskedPhone:string}[];quietHours:string;isAdmin:boolean};
const when=(v:string)=>new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'});
const errorMessage=(e:unknown)=>e instanceof Error?e.message:'The check-in could not be saved.';
const answers={'1':'Reports doing okay','2':'Requests a callback','3':'Requests help'};
const deliveryLabels:Record<string,string>={queued:'Scheduled / waiting for relay',processing:'Relay is processing',accepted:'Gateway accepted',sent:'Sent by gateway',delivered:'Handset delivery reported',failed:'Sending failed',cancelled:'Cancelled',expired:'Send window expired',blocked:'Contact or SMS permission changed'};
function defaultSchedule(){
 const date=new Date(Date.now()+120000),ist=new Date(date.getTime()+330*60000);
 if(ist.getUTCHours()<8)ist.setUTCHours(8,0,0,0);
 else if(ist.getUTCHours()>=20){ist.setUTCDate(ist.getUTCDate()+1);ist.setUTCHours(8,0,0,0);}
 return ist.toISOString().slice(0,16);
}
export default function SmsCheckins({seniors,notify,onChanged,onOpenFollowups}:{seniors:{id:string;name:string}[];notify:(message:string)=>void;onChanged?:()=>void|Promise<unknown>;onOpenFollowups?:()=>void}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[seniorId,setSeniorId]=useState(seniors[0]?.id||''),[language,setLanguage]=useState('en'),[schedule,setSchedule]=useState(defaultSchedule),[windowHours,setWindowHours]=useState(4),[consent,setConsent]=useState(false),[includeReviewed,setIncludeReviewed]=useState(false),[review,setReview]=useState<{id:string;reply:boolean}|null>(null),[outcome,setOutcome]=useState('');
 const loading=useRef(false),acting=useRef(false),requestKey=useRef('');
 const refresh=useCallback(async()=>{if(loading.current)return;loading.current=true;try{setState(await careApi<State>('/sms-checkins'));setError('');}catch(e){setError(errorMessage(e));}finally{loading.current=false;}},[]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)return refresh();});const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);return()=>{active=false;clearInterval(timer);};},[refresh]);
 const changed=()=>{requestKey.current='';setConsent(false);};
 async function create(e:React.FormEvent){
  e.preventDefault();if(acting.current)return;acting.current=true;setBusy(true);
  try{
   requestKey.current||=crypto.randomUUID();
   await careApi('/sms-checkins','POST',{seniorId,language,sendAt:new Date(schedule+':00+05:30').toISOString(),windowHours,consentConfirmed:consent,idempotencyKey:requestKey.current});
   requestKey.current='';setConsent(false);notify('SMS check-in saved. Sending and the senior’s reply are tracked separately.');await refresh();
  }catch(e){notify(errorMessage(e));await refresh();}finally{acting.current=false;setBusy(false);}
 }
 async function act(id:string,action:'cancel'|'review'|'review-reply'){
  if(acting.current)return;acting.current=true;setBusy(true);
  try{await careApi(`/sms-checkins/${id}/${action}`,'POST',action==='cancel'?{}:{outcome});setReview(null);setOutcome('');notify(action==='cancel'?'Undispatched check-in cancelled.':'Human review saved. Complete linked follow-up tasks separately.');await refresh();await onChanged?.();}catch(e){notify(errorMessage(e));}finally{acting.current=false;setBusy(false);}
 }
 const contacts=state?.contacts.filter(c=>c.seniorId===seniorId)||[];
 const visible=state?.checkins.filter(c=>includeReviewed||!c.reviewedAt)||[];
 const reviewForm=(id:string,reply=false)=>review?.id===id&&<form className="sms-review-form" onSubmit={e=>{e.preventDefault();void act(id,reply?'review-reply':'review');}}><label>Human review outcome<textarea required minLength={5} maxLength={1600} rows={3} value={outcome} onChange={e=>setOutcome(e.target.value)}/></label><div className="phone-support-actions"><button className="button primary" disabled={busy}>Save review</button><button type="button" className="button secondary" disabled={busy} onClick={()=>setReview(null)}>Cancel</button></div></form>;
 return <section className="sms-checkins" aria-label="Two-way SMS check-ins">
  <header><h2>Wellbeing by SMS</h2><p>Send one simple question to the senior’s registered phone. They can reply without opening the website.</p></header>
  {error&&<p className="extension-error" role="alert">{error} <button type="button" onClick={refresh}>Retry</button></p>}
  <form className="panel sms-checkin-form" onSubmit={create}><h3>Schedule a question</h3><div className="sms-checkin-fields"><label>Senior<select value={seniorId} onChange={e=>{setSeniorId(e.target.value);changed();}}>{seniors.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id}</option>)}</select></label><label>Prompt language<select value={language} onChange={e=>{setLanguage(e.target.value);changed();}}><option value="en">English</option><option value="hi">Hindi (Roman script / Hinglish)</option></select></label><label>Send at · India time<input type="datetime-local" required value={schedule} onChange={e=>{setSchedule(e.target.value);changed();}}/></label><label>Time to reply<select value={windowHours} onChange={e=>{setWindowHours(Number(e.target.value));changed();}}>{[2,4,8,24].map(h=><option key={h} value={h}>{h} hours</option>)}</select></label></div>
   <p>{contacts.length===1?`Saved senior mobile: ${contacts[0].maskedPhone}`:'A single active senior account needs a confirmed mobile with SMS permission. Set it under Accounts → Mobile & channels.'}</p>
   <div className="sms-checkin-example"><strong>Response choices</strong><span>1 · I’m okay &nbsp; 2 · Please call me &nbsp; 3 · I need help</span><small>Shared phones must include the question’s six-character reference code, for example ABC123 2. Follow the instructions in the actual SMS.</small></div>
   <label className="sms-checkin-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/> The senior agreed to this SMS check-in.</label><div className="phone-support-actions"><button className="button primary" disabled={busy||contacts.length!==1||!consent}>{busy?'Saving…':'Save SMS check-in'}</button><button type="button" className="button secondary" onClick={refresh}>Refresh status</button></div><p className="sms-checkin-note">Questions send between 08:00 and 20:00 IST. STOP withdraws SMS permission. The paired phone and receiver must be online. SIM plan limits apply.</p>
  </form>
  <div className="sms-checkin-list-heading"><h3>Questions &amp; replies</h3><label><input type="checkbox" checked={includeReviewed} onChange={e=>setIncludeReviewed(e.target.checked)}/> Include reviewed</label></div>
  {!state&&!error&&<p role="status">Loading saved check-ins…</p>}
  {state&&!visible.length&&<p className="panel phone-support-empty">No check-ins in this view.</p>}
  {visible.map(c=><article className="panel sms-checkin-card" key={c.id}><div className="phone-support-request-heading"><div><h3>{c.seniorName||c.seniorId} · {c.seniorId}</h3><p>{c.maskedPhone} · Ref <strong>{c.code}</strong></p></div><span className={`sms-answer ${c.answer==='3'?'needs-help':''}`}>{c.answer?answers[c.answer]:c.overdueAt?'No reply · contact needed':'Awaiting reply'}</span></div><dl><div><dt>Delivery</dt><dd>{deliveryLabels[c.deliveryStatus]||c.deliveryStatus}</dd></div><div><dt>Send time</dt><dd>{when(c.sendAt)} IST</dd></div><div><dt>Reply due</dt><dd>{when(c.dueAt)} IST</dd></div>{c.answeredAt&&<div><dt>Reply received</dt><dd>{when(c.answeredAt)} IST</dd></div>}</dl><details><summary>Read the saved question</summary><p className="sms-prompt">{c.prompt}</p></details><p className="sms-checkin-note">{c.answer==='1'?'Self-reported wellbeing only. Existing concerns and follow-ups remain active.':c.answer?'Verify the reply and arrange contact.':c.overdueAt?'Wellbeing remains unknown. No reply does not prove a missed dose or an emergency.':'A gateway receipt is not a human answer.'}</p>{(c.followupId||c.overdueTaskId||c.reviewTaskId)&&<p className="sms-checkin-followup">A care follow-up has been saved. {onOpenFollowups&&<button type="button" onClick={onOpenFollowups}>Open follow-ups →</button>}</p>}{c.outcome&&<p><strong>Review:</strong> {c.outcome}</p>}<div className="phone-support-actions">{!c.reviewedAt&&<button type="button" className="button secondary" disabled={busy} onClick={()=>{setReview({id:c.id,reply:false});setOutcome('');}}>Record human review</button>}{c.deliveryStatus==='queued'&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void act(c.id,'cancel')}>Cancel unsent question</button>}</div>{reviewForm(c.id)}</article>)}
  {!!state?.reviewReplies.length&&<section className="sms-checkin-replies"><h3>Replies needing Operations review</h3><p>Ambiguous, late or changed answers are retained without guessing a senior’s response.</p>{state.reviewReplies.filter(r=>includeReviewed||!r.reviewedAt).map(r=><article className="panel sms-checkin-card" key={r.id}><h4>{r.maskedSender} · {when(r.receivedAt)} IST</h4><p>Reply: “{r.message}” · {r.resolution.replaceAll('_',' ')}</p>{r.outcome?<p>{r.outcome}</p>:<button className="button secondary" disabled={busy} onClick={()=>{setReview({id:r.id,reply:true});setOutcome('');}}>Record identity / contact review</button>}{reviewForm(r.id,true)}</article>)}</section>}
 </section>;
}
