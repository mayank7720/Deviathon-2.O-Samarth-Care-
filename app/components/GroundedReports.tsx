"use client";

import { useEffect,useRef,useState } from 'react';
import { careApi } from './AccessPortal';
import './grounded-reports.css';

type SeniorOption={id:string;name:string};
type Evidence={id:string;date:string;sourceRecordId?:string;fields?:string[];cues?:string[]};
type Fact={id:string;kind:string;values?:Record<string,unknown>;sourceIds?:string[];text?:{en?:string;hi?:string}};
type Report={id:string;seniorId:string;createdAt:string;status:string;text?:string;method?:string;provider?:string;model?:string;factsHash?:string;period?:{from?:string;to?:string};evidence?:Evidence[];facts?:{statements?:Fact[];evidence?:Evidence[];dataKind?:string};generation?:{llmUsed?:boolean;provider?:string;model?:string;fallbackReason?:string};limitations?:string[];error?:string;retryAllowed?:boolean;inspectionRequired?:boolean;retryJobId?:string|null;failureCode?:string|null;deadlineAt?:number|null};
type Props={data:{seniors?:SeniorOption[];session:{role:string;isAdmin?:boolean}};notify:(message:string)=>void;onChanged?:()=>void|Promise<void>;onOpenDeliveries?:()=>void};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Unable to load the report.';
const failureMessages:Record<string,string>={model_error:'The model request did not complete successfully.',invalid_output:'The model response did not pass the saved-evidence checks.',workflow_error:'The report workflow could not prepare the model request.',callback_rejected:'The workflow could not confirm a saved report result.',deadline_exceeded:'The five-minute report deadline passed without an accepted result.'};
const string=(value:unknown)=>typeof value==='string'?value:'';
function reportList(value:unknown):Report[]{return Array.isArray(value)?value.filter(item=>typeof object(item).id==='string') as Report[]:[];}
function stamp(value:string){return value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not recorded';}
function factValue(values:Record<string,unknown>={}) {return Object.entries(values).filter(([,value])=>['number','string','boolean'].includes(typeof value)).map(([key,value])=>`${key.replaceAll(/([A-Z])/g,' $1').toLowerCase()}: ${String(value)}`).join(' · ');}

export default function GroundedReports({data,notify,onChanged,onOpenDeliveries}:Props) {
  const [choice,setChoice]=useState(''),[language,setLanguage]=useState('en'),[mode,setMode]=useState('local');
  const selectedId=choice||data.seniors?.[0]?.id||'';
  const [reports,setReports]=useState<Report[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[n8nConfigured,setN8nConfigured]=useState(false);
  const terminalRetries=useRef(new Map<string,string>());
  const retry=useRef<{signature:string;key:string}|null>(null);
  const canGenerate=data.session.role==='coordinator'||data.session.role==='operations'&&data.session.isAdmin===true;
  useEffect(()=>{
    let active=true;
    if(selectedId)careApi(`/reports?seniorId=${encodeURIComponent(selectedId)}`).then(result=>{if(active){setReports(reportList(result.reports));setError('');}}).catch(reason=>{if(active)setError(errorMessage(reason));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[selectedId]);
  useEffect(()=>{
    let active=true;
    careApi('/integrations/status').then(result=>{if(active)setN8nConfigured(object(result.n8n).configured===true);}).catch(()=>{if(active)setN8nConfigured(false);});
    return()=>{active=false;};
  },[]);
  async function refresh(){
    if(!selectedId)return;
    setLoading(true);
    try{const result=await careApi(`/reports?seniorId=${encodeURIComponent(selectedId)}`);setReports(reportList(result.reports));setError('');}catch(reason){setError(errorMessage(reason));}finally{setLoading(false);}
  }
  useEffect(()=>{
    if(!reports.some(report=>['queued','processing','awaiting_n8n'].includes(report.status)))return;
    const timer=setInterval(()=>{careApi(`/reports?seniorId=${encodeURIComponent(selectedId)}`).then(result=>{setReports(reportList(result.reports));setError('');}).catch(reason=>setError('Report status could not be refreshed. '+errorMessage(reason)));},10000);
    return()=>clearInterval(timer);
  },[reports,selectedId]);
  async function generate(event:React.FormEvent){
    event.preventDefault();if(!selectedId||!canGenerate)return;
    setBusy(true);setError('');
    const signature=JSON.stringify({selectedId,language,mode});
    if(retry.current?.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
    try{
      const result=await careApi('/reports','POST',{seniorId:selectedId,language,mode,idempotencyKey:retry.current.key});
      const report=object(result.report);
      if(typeof report.id==='string')setReports(prior=>[report as Report,...prior.filter(item=>item.id!==report.id)]);
      retry.current=null;await onChanged?.();
      notify(mode==='n8n'?'Report job submitted. Only validated model output can become a review draft.':'Report computed from the recorded observations. Review it before family sharing.');
    }catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}
  }
  async function retryFailed(report:Report){
    if(!canGenerate||!n8nConfigured||!report.retryAllowed||busy)return;
    setBusy(true);setError('');
    let key=terminalRetries.current.get(report.id);
    if(!key){key=crypto.randomUUID();terminalRetries.current.set(report.id,key);}
    try{
      const result=await careApi('/reports','POST',{action:'retry',reportId:report.id,idempotencyKey:key});
      const saved=object(result.report);
      if(typeof saved.id==='string')setReports(prior=>[saved as Report,...prior.filter(item=>item.id!==saved.id)]);
      terminalRetries.current.delete(report.id);
      await refresh();await onChanged?.();
      notify(result.repeated?'The existing retry is shown. No second model request was sent.':'A new report attempt was saved and submitted.');
    }catch(reason){await refresh();setError(errorMessage(reason));}finally{setBusy(false);}
  }
  return <>
    <section className="page-intro"><div><span className="eyebrow">REPORTS YOU CAN TRACE</span><h1>Evidence & weekly reports</h1><p>Every figure comes from a recorded observation. Missing information stays visible, and a person approves family updates.</p></div></section>
    <section className="panel grounded-report-controls">
      <form onSubmit={generate}>
        <label>Senior<select value={selectedId} onChange={event=>{setChoice(event.target.value);setLoading(true);}}>{data.seniors?.map(senior=><option key={senior.id} value={senior.id}>{senior.name} · {senior.id}</option>)}</select></label>
        <label>Report language<select value={language} onChange={event=>setLanguage(event.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option></select></label>
        <label>Generation method<select value={mode} onChange={event=>setMode(event.target.value)}><option value="local">Computed evidence report</option><option value="n8n" disabled={!n8nConfigured}>n8n + configured language model{n8nConfigured?'':' (not connected)'}</option></select></label>
        <button className="button primary" disabled={busy||!selectedId||!canGenerate}>{busy?'Preparing report…':'Create review draft'}</button>
      </form>
      <div className="grounded-report-explanation"><strong>{n8nConfigured?'n8n connection configured':'Computed reports are ready'}</strong><p>The model may select and arrange verified statements. It cannot add readings, diagnoses or predicted events. The computed mode does not use an LLM.</p></div>
    </section>
    <div className="grounded-report-toolbar"><span>{reports.length} recorded report{reports.length===1?'':'s'}</span><button className="button secondary" onClick={refresh} disabled={busy||loading}>Refresh reports</button></div>
    {error&&<p className="extension-error" role="alert">{error}</p>}
    {loading?<div className="panel grounded-report-empty">Loading recorded reports…</div>:!reports.length?<div className="panel grounded-report-empty"><h2>No report has been generated yet</h2><p>Create a draft from the selected senior’s available entries. No figures are prefilled as an AI result.</p></div>:<div className="grounded-report-list">{reports.map(report=>{
      const evidence=report.evidence||report.facts?.evidence||[],statements=report.facts?.statements||[];
      return <article className="panel grounded-report-card" key={report.id}>
        <header><div><span className="eyebrow">{report.period?.from||'Recorded period'}{report.period?.to?` — ${report.period.to}`:''}</span><h2>{report.method||'Weekly wellbeing report'}</h2></div><span className={`grounded-report-status ${report.status}`}>{report.status.replaceAll('_',' ')}</span></header>
        <p className="grounded-report-copy">{report.text||(['queued','processing','awaiting_n8n'].includes(report.status)?'The model is processing the saved evidence. A result must pass validation within five minutes before a review draft is available.':['failed','timed_out','expired'].includes(report.status)?'No accepted report was created for this attempt.':'No report text is available for this record.')}</p>
        {['failed','timed_out','expired'].includes(report.status)&&<div className="grounded-report-failure" role="status"><strong>{report.status==='failed'?'Generation stopped':'Report deadline reached'}</strong><p>{failureMessages[report.failureCode||'']||'The report did not reach a confirmed result.'}</p>{report.inspectionRequired?<p>A coordinator must inspect the n8n execution before another model request. The previous request may have reached the provider, so an automatic retry is blocked.</p>:report.retryJobId?<p>A retry has already been allocated. Its progress appears in the report list.</p>:report.retryAllowed?<><p>You can explicitly start one new attempt from the same saved evidence.</p>{canGenerate&&<button type="button" className="button secondary" disabled={busy||!n8nConfigured} onClick={()=>retryFailed(report)}>{busy?'Saving attempt…':n8nConfigured?'Retry saved evidence':'Reconnect n8n to retry'}</button>}</>:null}</div>}
        {report.deadlineAt&&['queued','processing','awaiting_n8n'].includes(report.status)&&<p className="grounded-report-note">Awaiting a validated result until {stamp(new Date(report.deadlineAt).toISOString())}. Status refreshes every 10 seconds.</p>}
        {report.error&&<p className="extension-error">{report.error}</p>}
        {report.generation?.fallbackReason&&<p className="grounded-report-note">{report.generation.fallbackReason}</p>}
        <dl className="grounded-report-meta"><div><dt>Created</dt><dd>{stamp(report.createdAt)}</dd></div><div><dt>Language model</dt><dd>{report.generation?.llmUsed?`${report.generation.provider||report.provider||'Configured provider'} · ${report.generation.model||report.model||'Configured model'}`:'No accepted LLM result'}</dd></div><div><dt>Data provenance</dt><dd>{report.facts?.dataKind?.replaceAll('_',' ')||'See source records'}</dd></div></dl>
        {statements.length>0&&<details><summary>Inspect computed facts ({statements.length})</summary><div className="grounded-report-table-wrap"><table><thead><tr><th>Fact</th><th>Observed values</th><th>Source evidence</th></tr></thead><tbody>{statements.map(fact=><tr key={fact.id}><td><strong>{fact.id.replaceAll('_',' ')}</strong><p>{fact.text?.[language as 'en'|'hi']||fact.text?.en||''}</p></td><td>{factValue(fact.values)}</td><td>{fact.sourceIds?.join(', ')||'Window completeness calculation'}</td></tr>)}</tbody></table></div></details>}
        {evidence.length>0&&<details><summary>Trace to source entries ({evidence.length})</summary><ul className="grounded-evidence-list">{evidence.map(item=><li key={item.id}><strong>{item.id}</strong><span>{item.date}</span><span>{item.fields?.join(', ')||item.cues?.join(', ')||'Recorded observation'}</span>{item.sourceRecordId&&<code>{item.sourceRecordId}</code>}</li>)}</ul></details>}
        {report.factsHash&&<p className="grounded-report-hash">Evidence fingerprint <code>{string(report.factsHash)}</code></p>}
        <div className="grounded-report-review"><p>{report.status==='approved'?'A coordinator has approved this report. Family access still depends on current sharing consent.':'Family delivery approval is managed in the notification center. A generated draft is not an approval or proof of delivery.'}</p>{report.status==='pending_review'&&onOpenDeliveries&&<button className="button secondary" onClick={onOpenDeliveries}>Review family delivery</button>}</div>
      </article>;
    })}</div>}
  </>;
}
