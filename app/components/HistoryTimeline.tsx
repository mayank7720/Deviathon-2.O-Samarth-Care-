"use client";

import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import './history-timeline.css';
import './history-timeline-modern.css';

type Props={seniorId:string;asOfDate:string;cohortStart?:string;cohortEnd?:string;refreshKey?:number};
type Period='day'|'week'|'month'|'90days'|'custom';
type Grouping='day'|'week'|'month';
type Range={from:string;to:string};
type ReadingStats={mean:number|null;min?:number|null;max?:number|null;count?:number};
type Observation={
 id:string;seniorId:string;date:string;observedAt?:string|null;recordedAt?:string|null;timePrecision?:string;synthetic:boolean;source?:string;
 record:{vitals?:Record<string,number|null>;medication?:{taken?:number;prescribed?:number;doses?:{name:string;scheduledTime?:string;status:string}[]};note?:string;activity?:number;sleep?:number;lifestyle?:Record<string,number|string|null>;sensor?:Record<string,number|boolean|null>};
};
type Bucket={from:string;to:string;observedDays:number;calendarDays:number;observationCount:number;vitals?:Record<string,ReadingStats>;medication?:{taken?:number;prescribed?:number;adherence?:number|null};notesCount?:number};
type RiskPoint={date:string;score:number|null;urgency?:string};
type HistoryData={
 range:Range&{asOfDate:string;timezone:string};entries:Observation[];buckets:Bucket[];risk:RiskPoint[];
 pagination:{nextCursor:string|null;hasMore:boolean};coverage:{observedDays:number;calendarDays:number;observationCount:number};dataset?:{version?:string;synthetic?:boolean};
 rebuildPending?:boolean;
};
type RequestState={key:string;data?:HistoryData;error?:string};
const DAY=86400000;
const TIMEZONE='Asia/Kolkata';
const modes:{value:Period;label:string}[]=[{value:'day',label:'Day'},{value:'week',label:'Week'},{value:'month',label:'Month'},{value:'90days',label:'90 days'},{value:'custom',label:'Custom'}];
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
const addDays=(value:string,days:number)=>new Date(Date.parse(value+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const dayCount=(range:Range)=>Math.round((Date.parse(range.to)-Date.parse(range.from))/DAY)+1;
function shortDate(value:string){return validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('en-IN',{timeZone:TIMEZONE,day:'numeric',month:'short',year:'numeric'}):value;}
function timestamp(value?:string|null){return value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-IN',{timeZone:TIMEZONE,dateStyle:'medium',timeStyle:'short'}):'Not recorded';}
function monthRange(anchor:string):Range{const date=new Date(anchor+'T00:00:00Z');return {from:`${anchor.slice(0,7)}-01`,to:new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).toISOString().slice(0,10)};}
function periodRange(mode:Period,anchor:string,custom:Range,min:string,max:string):Range{
 let result:Range;
 if(mode==='custom')result=custom;
 else if(mode==='month')result=monthRange(anchor);
 else if(mode==='week'){
  const weekday=(new Date(anchor+'T00:00:00Z').getUTCDay()+6)%7;
  const from=addDays(anchor,-weekday);result={from,to:addDays(from,6)};
 }else result={from:mode==='90days'?addDays(anchor,-89):anchor,to:anchor};
 return {from:result.from<min?min:result.from,to:result.to>max?max:result.to};
}
function shiftAnchor(mode:Period,anchor:string,direction:number,range:Range){
 if(mode==='month'){
  const date=new Date(anchor+'T00:00:00Z');return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+direction,1)).toISOString().slice(0,10);
 }
 return addDays(anchor,direction*(mode==='week'?7:mode==='90days'?90:mode==='custom'?dayCount(range):1));
}
const failure=(value:unknown)=>value instanceof Error?value.message:'The recorded history could not be loaded.';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
async function fetchHistory(url:string,signal:AbortSignal):Promise<HistoryData>{
 const response=await fetch(url,{signal,cache:'no-store'});
 const result:unknown=await response.json();
 const body=object(result);
 if(!response.ok)throw new Error(typeof body.error==='string'?body.error:'The recorded history could not be loaded.');
 if(!Array.isArray(body.entries)||!Array.isArray(body.buckets)||!Array.isArray(body.risk)||!body.range||!body.coverage||!body.pagination)throw new Error('The history response was incomplete. Please try again.');
 return body as HistoryData;
}
function value(value:unknown,digits=1){return number(value)?Number(value).toLocaleString('en-IN',{maximumFractionDigits:digits}):'—';}
function mean(bucket:Bucket,key:string,unit:string){const stats=bucket.vitals?.[key];return number(stats?.mean)?`${value(stats?.mean)} ${unit}`:'—';}
function doseSummary(medication?:{taken?:number;prescribed?:number}){return number(medication?.prescribed)&&Number(medication?.prescribed)>0?`${value(medication?.taken,0)} / ${value(medication?.prescribed,0)}`:'Not recorded';}
function sourceLabel(entry:Observation){
 if(entry.synthetic)return 'Synthetic history';
 const known:Record<string,string>={coordinator:'Coordinator entry','approved-speech-note':'Reviewed voice note','local-whisper-reviewed':'Reviewed voice note','browser-motion-unverified':'Phone motion check-in','phone-gateway':'Phone check-in'};
 return known[entry.source||'']||entry.source?.replaceAll(/[-_]/g,' ')||'Recorded observation';
}
function RiskChart({points,range}:{points:RiskPoint[];range:Range}){
 const descriptionId=useId();
 const width=640,height=164,left=35,right=12,top=12,bottom=24;
 const span=Math.max(1,dayCount(range)-1),plotWidth=width-left-right,plotHeight=height-top-bottom;
 const selected=points.filter(point=>validDate(point.date)&&point.date>=range.from&&point.date<=range.to);
 const sorted=[...selected].sort((a,b)=>a.date.localeCompare(b.date));
 const paths:string[]=[];let path='',previous:string|null=null;
 for(const point of sorted){
  if(!number(point.score)){if(path)paths.push(path);path='';previous=null;continue;}
  if(previous&&addDays(previous,1)!==point.date){if(path)paths.push(path);path='';}
  const x=left+Math.round((Date.parse(point.date)-Date.parse(range.from))/DAY)/span*plotWidth;
  const y=top+(100-Math.min(100,Math.max(0,Number(point.score))))/100*plotHeight;
  path+=`${path?' L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`;previous=point.date;
 }
 if(path)paths.push(path);
 const measured=sorted.filter(point=>number(point.score));
 if(!measured.length)return <p className="history-empty">No risk scores are available for this period. Early baseline days can remain unscored.</p>;
 return <div className="history-risk-chart">
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={descriptionId}>
   <title id={descriptionId}>Daily risk scores from {shortDate(range.from)} to {shortDate(range.to)}. Gaps indicate unavailable scores.</title>
   {[0,50,100].map(score=>{const y=top+(100-score)/100*plotHeight;return <g key={score}><line x1={left} y1={y} x2={width-right} y2={y} className="history-chart-grid"/><text x={left-8} y={y+4} textAnchor="end">{score}</text></g>;})}
   {paths.map((line,index)=><path key={index} d={line} className="history-chart-line"/>)}
   {measured.filter((point,index)=>index===0||index===measured.length-1||!sorted.some(other=>other.date===addDays(point.date,-1)&&number(other.score))&&!sorted.some(other=>other.date===addDays(point.date,1)&&number(other.score))).map(point=><circle key={point.date} cx={left+Math.round((Date.parse(point.date)-Date.parse(range.from))/DAY)/span*plotWidth} cy={top+(100-Math.min(100,Math.max(0,Number(point.score))))/100*plotHeight} r="2.6" className="history-chart-point"/>)}
   <text x={left} y={height-4}>{shortDate(range.from)}</text><text x={width-right} y={height-4} textAnchor="end">{shortDate(range.to)}</text>
  </svg>
  <p className="history-muted">Daily review priority, 0–100. Gaps mean no score; they do not mean low risk.</p>
  <details className="history-score-values"><summary>View daily score values</summary><div className="history-table-scroll"><table><thead><tr><th>Date</th><th>Score</th><th>Review priority</th></tr></thead><tbody>{sorted.map(point=><tr key={point.date}><td>{shortDate(point.date)}</td><td>{number(point.score)?`${value(point.score,0)} / 100`:'Unavailable'}</td><td>{number(point.score)?point.urgency?.replaceAll('_',' ')||'See daily score':'More observations needed'}</td></tr>)}</tbody></table></div></details>
 </div>;
}
function ObservationCard({entry}:{entry:Observation}){
 const r=entry.record||{},vitals=r.vitals||{};
 const readings:[string,string][]=[];
 const add=(label:string,reading:unknown,unit:string)=>{if(number(reading))readings.push([label,`${value(reading)} ${unit}`]);};
 if(number(vitals.systolic)||number(vitals.diastolic))readings.push(['Blood pressure',`${value(vitals.systolic,0)} / ${value(vitals.diastolic,0)} mmHg`]);
 add('Blood glucose',vitals.glucose,'mg/dL');add('SpO₂',vitals.spo2,'%');add('Weight',vitals.weight,'kg');
 add('Activity',r.lifestyle?.steps??r.sensor?.steps??r.activity,'steps');add('Sleep',r.lifestyle?.sleepHours??r.sleep,'hours');
 if(r.medication)readings.push(['Doses logged as taken',doseSummary(r.medication)]);
 for(const [key,label,unit] of [['waterGlasses','Water','glasses'],['meals','Meals',''],['painScore','Reported pain','/ 10']] as const)add(label,r.lifestyle?.[key],unit);
 const measured=entry.timePrecision!=='day'&&!!entry.observedAt;
 return <li className="history-observation"><article>
  <header><div><time dateTime={entry.date}>{shortDate(entry.date)}</time><p>{measured?timestamp(entry.observedAt):'Time not recorded'}</p></div><span className={`history-origin ${entry.synthetic?'synthetic':'recorded'}`}>{entry.synthetic?'Synthetic':'Recorded'}</span></header>
  <p className="history-source">{sourceLabel(entry)}</p>
  {readings.length>0&&<dl className="history-readings">{readings.map(([label,reading])=><div key={label}><dt>{label}</dt><dd>{reading}</dd></div>)}</dl>}
  {typeof r.lifestyle?.mood==='string'&&<p className="history-note"><strong>Reported mood:</strong> {r.lifestyle.mood}</p>}
  {r.note&&<p className="history-note">{r.note}</p>}
  {r.sensor?.fallDetected===true&&<p className="history-motion-note">Possible fall flagged by a device. A person must verify what happened.</p>}
  {r.medication?.doses?.length? <details className="history-dose-details"><summary>Dose entries ({r.medication.doses.length})</summary><ul>{r.medication.doses.map((dose,index)=><li key={`${dose.name}:${dose.scheduledTime}:${index}`}><strong>{dose.name}</strong><span>{dose.scheduledTime?`Scheduled ${dose.scheduledTime}`:'Schedule not recorded'}</span><span>{dose.status==='taken'?'Logged as taken':dose.status==='missed'?'Logged as missed':'Status unknown'}</span></li>)}</ul></details>:null}
  <footer>{entry.recordedAt?<>Saved <time dateTime={entry.recordedAt}>{timestamp(entry.recordedAt)}</time></>:entry.synthetic?'Generated history. No original save time.':'Save time not recorded.'}</footer>
 </article></li>;
}
function HistoryContent({seniorId,asOfDate,cohortStart,cohortEnd,refreshKey=0}:Props){
 const headingId=useId();
 const min=validDate(cohortStart||'')?cohortStart!:'1900-01-01';
 const max=validDate(asOfDate)?asOfDate:'1900-01-01';
 const initialFrom=addDays(max,-89)<min?min:addDays(max,-89);
 const [mode,setMode]=useState<Period>('90days'),[anchor,setAnchor]=useState(max),[groupBy,setGroupBy]=useState<Grouping>('week');
 const [custom,setCustom]=useState<Range>({from:initialFrom,to:max}),[draft,setDraft]=useState<Range>({from:initialFrom,to:max}),[rangeError,setRangeError]=useState(''),[retry,setRetry]=useState(0);
 const [state,setState]=useState<RequestState|null>(null),[loadingMore,setLoadingMore]=useState(false),[moreError,setMoreError]=useState('');
 const moreController=useRef<AbortController|null>(null);
 const range=useMemo(()=>periodRange(mode,anchor,custom,min,max),[mode,anchor,custom,min,max]);
 const parameters=new URLSearchParams({from:range.from,to:range.to,groupBy,limit:'10'}).toString();
 const url=`/api/history/${encodeURIComponent(seniorId)}?${parameters}`,key=`${url}:${refreshKey}:${retry}`;
 const current=state?.key===key?state:null,data=current?.data,loading=!current;
 const invalid=!validDate(asOfDate)||min>max;
 useEffect(()=>{
  if(invalid)return;
  const controller=new AbortController();let active=true;
  fetchHistory(url,controller.signal).then(result=>{if(active){setState({key,data:result});setMoreError('');setLoadingMore(false);}}).catch(error=>{if(active&&!controller.signal.aborted)setState({key,error:failure(error)});});
  return()=>{active=false;controller.abort();moreController.current?.abort();};
 },[url,key,invalid]);
 function chooseMode(next:Period){
  setMode(next);setRangeError('');setMoreError('');
  if(next==='custom'){setDraft(range);setCustom(range);}
  if(next==='day')setGroupBy('day');
  if(next==='week')setGroupBy('day');
  if(next==='month')setGroupBy('week');
  if(next==='90days')setGroupBy('week');
 }
 function move(direction:number){
  if(mode==='custom'){
   const shift=dayCount(range)*direction;
   let next={from:addDays(range.from,shift),to:addDays(range.to,shift)};
   if(next.to>max){const offset=Math.round((Date.parse(next.to)-Date.parse(max))/DAY);next={from:addDays(next.from,-offset),to:max};}
   if(next.from<min){const offset=Math.round((Date.parse(min)-Date.parse(next.from))/DAY);next={from:min,to:addDays(next.to,offset)>max?max:addDays(next.to,offset)};}
   setCustom(next);setDraft(next);
  }else{
   const next=shiftAnchor(mode,anchor,direction,range);setAnchor(next>max?max:next<min?min:next);
  }
  setRangeError('');
 }
 function applyRange(event:FormEvent){
  event.preventDefault();
  if(!validDate(draft.from)||!validDate(draft.to)||draft.from>draft.to){setRangeError('Choose a valid start date on or before the end date.');return;}
  if(draft.from<min||draft.to>max){setRangeError(`Choose dates from ${shortDate(min)} to ${shortDate(max)}.`);return;}
  if(dayCount(draft)>366){setRangeError('Choose a period of 366 days or less.');return;}
  setCustom(draft);setRangeError('');setMoreError('');
 }
 async function loadMore(){
  if(!data?.pagination.nextCursor||loadingMore)return;
  moreController.current?.abort();const controller=new AbortController();moreController.current=controller;
  setLoadingMore(true);setMoreError('');
  try{
   const next=await fetchHistory(`${url}&cursor=${encodeURIComponent(data.pagination.nextCursor)}`,controller.signal);
   if(controller.signal.aborted)return;
   setState(previous=>{
    if(previous?.key!==key||!previous.data)return previous;
    const seen=new Set(previous.data.entries.map(entry=>entry.id));
    return {key,data:{...previous.data,entries:[...previous.data.entries,...next.entries.filter(entry=>!seen.has(entry.id))],pagination:next.pagination}};
   });
  }catch(error){if(!controller.signal.aborted)setMoreError(failure(error));}finally{if(!controller.signal.aborted)setLoadingMore(false);}
 }
 return <section className="history-timeline" aria-labelledby={headingId}>
  <header className="history-heading"><div><h3 id={headingId}>Health history</h3><p>Readings, notes and daily review scores</p></div><span>India time (IST)</span></header>
  <div className="history-periods" role="group" aria-label="History period">{modes.map(item=><button type="button" key={item.value} aria-pressed={mode===item.value} onClick={()=>chooseMode(item.value)}>{item.label}</button>)}</div>
  {mode==='custom'?<form className="history-custom-range" onSubmit={applyRange}><label>From<input type="date" min={min} max={max} value={draft.from} onChange={event=>setDraft({...draft,from:event.target.value})} required/></label><label>To<input type="date" min={draft.from||min} max={max} value={draft.to} onChange={event=>setDraft({...draft,to:event.target.value})} required/></label><button type="submit" className="button secondary small">Apply dates</button></form>:<label className="history-anchor-label">{mode==='month'?'Month':mode==='week'?'Week containing':mode==='90days'?'90 days ending':'Date'}<input type={mode==='month'?'month':'date'} min={mode==='month'?min.slice(0,7):min} max={mode==='month'?max.slice(0,7):max} value={mode==='month'?anchor.slice(0,7):anchor} onChange={event=>{const chosen=mode==='month'?`${event.target.value}-01`:event.target.value;if(validDate(chosen)){setAnchor(chosen);setRangeError('');}}}/></label>}
  {rangeError&&<p className="history-error" role="alert">{rangeError}</p>}
  <div className="history-range-navigation"><button type="button" aria-label="Previous period" disabled={range.from<=min||invalid} onClick={()=>move(-1)}>‹ Previous</button><strong>{range.from===range.to?shortDate(range.from):`${shortDate(range.from)} – ${shortDate(range.to)}`}</strong><button type="button" aria-label="Next period" disabled={range.to>=max||invalid} onClick={()=>move(1)}>Next ›</button></div>
  <p className="history-view-note">This changes the history view only. The workspace date stays {shortDate(max)}.{mode==='week'?' Weeks run Monday to Sunday.':''}</p>
  {invalid?<p className="history-error" role="alert">A valid workspace date is needed to load this history.</p>:loading?<p className="history-empty" role="status">Loading recorded history…</p>:current.error?<div className="history-error" role="alert"><p>{current.error}</p><button type="button" className="button secondary small" onClick={()=>setRetry(value=>value+1)}>Try again</button></div>:data&&<>
   <dl className="history-coverage"><div><dt>Days with entries</dt><dd>{value(data.coverage.observedDays,0)} <small>/ {value(data.coverage.calendarDays,0)}</small></dd></div><div><dt>Observation entries</dt><dd>{value(data.coverage.observationCount,0)}</dd></div><div><dt>Days without entries</dt><dd>{value(Math.max(0,data.coverage.calendarDays-data.coverage.observedDays),0)}</dd></div></dl>
   <p className="history-muted">A day may have several entries. Missing entries do not mean normal health or a missed dose.</p>
   {data.rebuildPending&&<p className="history-rebuild-note" role="status">Recent entries are saved. Historical scores are being refreshed.</p>}
   <section className="history-section"><h4>Daily risk scores</h4><RiskChart points={data.risk} range={range}/></section>
   <section className="history-section"><div className="history-section-heading"><h4>Period summaries</h4><label>Group by<select value={groupBy} onChange={event=>{setGroupBy(event.target.value as Grouping);setMoreError('');}}><option value="day">Day</option><option value="week">Calendar week</option><option value="month">Calendar month</option></select></label></div>
    {data.buckets.length?<div className="history-table-scroll" role="region" aria-label="Period summaries" tabIndex={0}><table className="history-buckets"><caption>Means use submitted readings where available; otherwise synthetic baseline values. Repeated daily dose totals are not added together.</caption><thead><tr><th>Period</th><th>Days with data</th><th>Mean BP</th><th>Mean glucose</th><th>Mean SpO₂</th><th>Mean weight</th><th>Doses taken / scheduled</th></tr></thead><tbody>{data.buckets.map(bucket=><tr key={`${bucket.from}:${bucket.to}`}><th scope="row">{shortDate(bucket.from)}{bucket.to!==bucket.from&&<small>to {shortDate(bucket.to)}</small>}</th><td>{value(bucket.observedDays,0)} / {value(bucket.calendarDays,0)}<small>{value(bucket.observationCount,0)} entries</small></td><td>{number(bucket.vitals?.systolic?.mean)||number(bucket.vitals?.diastolic?.mean)?`${value(bucket.vitals?.systolic?.mean)} / ${value(bucket.vitals?.diastolic?.mean)} mmHg`:'—'}</td><td>{mean(bucket,'glucose','mg/dL')}</td><td>{mean(bucket,'spo2','%')}</td><td>{mean(bucket,'weight','kg')}</td><td>{doseSummary(bucket.medication)}</td></tr>)}</tbody></table></div>:<p className="history-empty">No period summaries are available.</p>}
   </section>
   <section className="history-section"><div className="history-section-heading"><h4>Observation entries</h4><span>{data.entries.length} shown{data.coverage.observationCount>=data.entries.length?` of ${value(data.coverage.observationCount,0)}`:''}</span></div>
    <p className="history-muted history-order-note">Newest measurement first. Entries with no recorded time follow within each day.</p>
    {data.entries.length?<div className="history-observation-scroll" role="region" aria-label="Observation entries" tabIndex={0}><ol className="history-observations">{data.entries.map(entry=><ObservationCard key={entry.id} entry={entry}/>)}</ol></div>:<p className="history-empty">No observations were recorded in this period.</p>}
    {moreError&&<p className="history-error" role="alert">{moreError}</p>}
    {data.pagination.hasMore&&<button type="button" className="button secondary history-more" onClick={loadMore} disabled={loadingMore||!data.pagination.nextCursor}>{loadingMore?'Loading more entries…':'Load older entries'}</button>}
   </section>
   {cohortStart&&cohortEnd&&<p className="history-dataset-note">Synthetic baseline history: {shortDate(cohortStart)} – {shortDate(cohortEnd)}. Each entry shows whether it is synthetic or separately recorded.</p>}
  </>}
 </section>;
}

export default function HistoryTimeline(props:Props){return <HistoryContent key={`${props.seniorId}:${props.asOfDate}`} {...props}/>;}
