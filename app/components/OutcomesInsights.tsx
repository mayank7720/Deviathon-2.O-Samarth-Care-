"use client";

import {useId,useMemo,useState,type ReactNode} from 'react';
import './outcomes-insights.css';

type Senior={id:string;name?:string;city?:string;score?:number|null;level?:string;urgency?:string;trend?:{date:string;score:number|null}[];careState?:{status?:string}};
type Snapshot={date?:string;seniors?:Senior[];tasks?:{id?:string;status?:string;seniorId?:string}[];sharedFollowups?:{id?:string;status?:string;seniorId?:string}[];operations?:Record<string,unknown>;metrics?:Record<string,unknown>};
type Props={data:Snapshot;seniors?:Senior[];onOpenSenior?:(senior:Senior)=>void};
type Segment={label:string;value:number;color:string};
const palette={high:'#b76a50',medium:'#d5aa62',low:'#54886a',unknown:'#a8b1a5',open:'#c59a59',progress:'#6b96a1',done:'#4e8265',cancelled:'#a5aaa3'};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const obj=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(obj):[];
const count=(value:unknown)=>finite(value)?Math.max(0,value):0;
const decimal=(value:unknown,digits=1)=>finite(value)?value.toLocaleString('en-IN',{maximumFractionDigits:digits}):'Not recorded';
const dateLabel=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T12:00:00Z').toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'}):date;
const level=(senior:Senior)=>senior.level==='unknown'||!finite(senior.score)?'unknown':senior.level==='high'||senior.score>=60?'high':senior.level==='medium'||senior.score>=30?'medium':'low';
function Legend({segments}:{segments:Segment[]}){return <ul className="outcomes-legend">{segments.map(item=><li key={item.label}><span style={{background:item.color}} aria-hidden="true"/>{item.label}<strong>{decimal(item.value,0)}</strong></li>)}</ul>;}
function Figure({title,description,children,wide=false}:{title:string;description:string;children:ReactNode;wide?:boolean}){return <section className={`outcomes-chart ${wide?'outcomes-wide':''}`}><header><h2>{title}</h2><p>{description}</p></header>{children}</section>;}
function Donut({segments,label}:{segments:Segment[];label:string}){
 const id=useId(),total=segments.reduce((n,s)=>n+s.value,0),length=2*Math.PI*70;
 return <div className="outcomes-donut"><svg viewBox="0 0 245 225" role="img" aria-labelledby={id}><title id={id}>{label}: {segments.map(s=>`${s.label} ${s.value}`).join(', ')}</title><circle cx="122" cy="107" r="70" fill="none" stroke="#edf1e9" strokeWidth="24"/>{segments.filter(s=>s.value>0).map((s,index,list)=>{const dash=total?s.value/total*length:0,offset=total?list.slice(0,index).reduce((sum,part)=>sum+part.value,0)/total*length:0;return <circle key={s.label} cx="122" cy="107" r="70" fill="none" stroke={s.color} strokeWidth="24" strokeDasharray={`${dash} ${length-dash}`} strokeDashoffset={-offset} transform="rotate(-90 122 107)"><title>{s.label}: {s.value}</title></circle>;})}<text x="122" y="108" textAnchor="middle" className="outcomes-donut-total">{total}</text><text x="122" y="133" textAnchor="middle" className="outcomes-donut-caption">{label}</text></svg><Legend segments={segments}/></div>;
}
function HorizontalBars({items,unit='',percent=false}:{items:{label:string;value:number|null;color?:string;detail?:string}[];unit?:string;percent?:boolean}){
 const width=650,left=160,right=70,max=percent?100:Math.max(1,...items.map(i=>i.value??0)),plot=width-left-right,height=Math.max(135,items.length*49+36);
 return <svg className="outcomes-bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={items.map(i=>`${i.label}: ${i.value===null?'Not recorded':decimal(i.value)+unit}`).join(', ')}>
 {[0,.5,1].map(p=><g key={p}><line x1={left+p*plot} y1="10" x2={left+p*plot} y2={height-24} stroke="#e9eee5" strokeDasharray="3 4"/><text x={left+p*plot} y={height-5} textAnchor="middle" className="outcomes-axis">{decimal(max*p,1)}{unit}</text></g>)}
 {items.map((item,index)=>{const y=index*49+20;return <g key={item.label}><text x={left-14} y={y+16} textAnchor="end" className="outcomes-bar-label">{item.label}</text>{item.value===null?<text x={left+8} y={y+16} className="outcomes-axis">No recorded response</text>:<><rect x={left} y={y} width={Math.max(0,item.value/max*plot)} height="23" rx="3" fill={item.color||'#5f8b70'}/><text x={Math.min(width-50,left+item.value/max*plot+9)} y={y+16} className="outcomes-bar-value">{decimal(item.value)}{unit}</text><title>{item.label}: {item.value}{unit}{item.detail?`. ${item.detail}`:''}</title></>}</g>;})}
 </svg>;
}
function CityMix({cities}:{cities:{city:string;counts:Record<string,number>;total:number}[]}){
 const id=useId(),left=116,width=655,plot=width-left-60,max=Math.max(1,...cities.map(c=>c.total)),height=Math.max(180,cities.length*48+35);
 return <><svg className="outcomes-bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}><title id={id}>Daily review priority by city. {cities.map(c=>`${c.city}: ${c.counts.high} high, ${c.counts.medium} medium, ${c.counts.low} routine, ${c.counts.unknown} unknown`).join('. ')}</title>{[0,.5,1].map(p=><g key={p}><line x1={left+p*plot} y1="9" x2={left+p*plot} y2={height-25} stroke="#e6ece2" strokeDasharray="3 4"/><text x={left+p*plot} y={height-5} textAnchor="middle" className="outcomes-axis">{decimal(max*p,0)}</text></g>)}{cities.map((city,index)=>{let offset=0;const y=index*48+18;return <g key={city.city}><text x={left-14} y={y+17} textAnchor="end" className="outcomes-bar-label">{city.city}</text>{(['high','medium','low','unknown'] as const).map(key=>{const value=city.counts[key],w=value/max*plot,rect=<rect key={key} x={left+offset} y={y} width={w} height="24" fill={palette[key]}><title>{city.city}, {key}: {value}</title></rect>;offset+=w;return rect;})}<text x={left+offset+10} y={y+17} className="outcomes-bar-value">{city.total}</text></g>;})}</svg><div className="outcomes-inline-legend">{[['High',palette.high],['Medium',palette.medium],['Routine',palette.low],['Unknown',palette.unknown]].map(([label,color])=><span key={label}><i style={{background:color}}/>{label}</span>)}</div></>;
}
function RiskTrend({seniors}:{seniors:Senior[]}){
 const id=useId();
 const points=useMemo(()=>{
  const days=new Map<string,number[]>();
  for(const senior of seniors){const unique=new Map((senior.trend||[]).map(point=>[point.date,point.score]));for(const [date,score] of unique){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;if(!days.has(date))days.set(date,[]);if(finite(score))days.get(date)!.push(score);}}
  return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,values])=>({date,count:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null}));
 },[seniors]);
 if(!points.some(p=>p.mean!==null))return <p className="outcomes-empty">There are no dated scores for a trend yet. Unknown scores remain gaps.</p>;
 const width=720,height=248,left=39,right=16,top=18,bottom=35,plot=width-left-right,low=Date.parse(points[0].date),range=Math.max(86400000,Date.parse(points.at(-1)!.date)-low);
 const xy=(point:typeof points[number])=>({x:left+(Date.parse(point.date)-low)/range*plot,y:top+(100-(point.mean??0))/100*(height-top-bottom)});
 const paths:string[]=[];let path='';for(const point of points){if(point.mean===null){if(path)paths.push(path);path='';continue;}const {x,y}=xy(point);path+=(path?' L':'M')+x.toFixed(1)+' '+y.toFixed(1);}if(path)paths.push(path);
 return <><svg className="outcomes-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}><title id={id}>Average daily review score from {points[0].date} to {points.at(-1)!.date}. Only available scores contribute. Unknown scores remain gaps.</title>{[0,25,50,75,100].map(value=>{const y=top+(100-value)/100*(height-top-bottom);return <g key={value}><line x1={left} y1={y} x2={width-right} y2={y} stroke="#e4ece0" strokeDasharray="3 5"/><text x={left-10} y={y+4} textAnchor="end" className="outcomes-axis">{value}</text></g>;})}{paths.map((d,i)=><path key={i} d={d} fill="none" stroke="#397b5a" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>)}{points.filter(p=>p.mean!==null).map(point=>{const {x,y}=xy(point);return <circle key={point.date} cx={x} cy={y} r="3.2" fill="#397b5a"><title>{dateLabel(point.date)}: {decimal(point.mean)} from {point.count} seniors</title></circle>;})}<text x={left} y={height-6} className="outcomes-axis">{dateLabel(points[0].date)}</text><text x={width-right} y={height-6} textAnchor="end" className="outcomes-axis">{dateLabel(points.at(-1)!.date)}</text></svg><p className="outcomes-chart-footnote">Average of available review scores, out of 100. The number of seniors with data can vary by day.</p></>;
}
export default function OutcomesInsights({data,seniors:provided,onOpenSenior}:Props){
 const seniors=provided||data.seniors||[],tasks=[...(data.tasks||[]),...(data.sharedFollowups||[])],operations=obj(data.operations),metrics=obj(data.metrics);
 const [tab,setTab]=useState<'care'|'model'>('care'),[city,setCity]=useState('all');
 const cities=[...new Set(seniors.map(s=>s.city||'Not assigned'))].sort();
 const selected=city==='all'?seniors:seniors.filter(s=>(s.city||'Not assigned')===city),selectedIds=new Set(selected.map(s=>s.id)),selectedTasks=tasks.filter(t=>city==='all'||!!t.seniorId&&selectedIds.has(t.seniorId));
 const levels={high:0,medium:0,low:0,unknown:0};for(const senior of selected)levels[level(senior)]++;
 const priority=[{label:'High priority',value:levels.high,color:palette.high},{label:'Medium priority',value:levels.medium,color:palette.medium},{label:'Routine',value:levels.low,color:palette.low},{label:'More information needed',value:levels.unknown,color:palette.unknown}];
 const taskCounts={open:0,progress:0,done:0,cancelled:0};for(const task of selectedTasks){if(task.status==='completed'||task.status==='resolved')taskCounts.done++;else if(task.status==='cancelled')taskCounts.cancelled++;else if(['in_progress','accepted','acknowledged','reported_done'].includes(task.status||''))taskCounts.progress++;else taskCounts.open++;}
 const taskSegments=[{label:'Open',value:taskCounts.open,color:palette.open},{label:'In progress',value:taskCounts.progress,color:palette.progress},{label:'Completed',value:taskCounts.done,color:palette.done},{label:'Cancelled',value:taskCounts.cancelled,color:palette.cancelled}];
 const cityMix=cities.filter(name=>city==='all'||city===name).map(name=>{const found=selected.filter(s=>(s.city||'Not assigned')===name),counts={high:0,medium:0,low:0,unknown:0};for(const senior of found)counts[level(senior)]++;return {city:name,counts,total:found.length};});
 const responses=rows(operations.byCity||operations.cities).filter(row=>city==='all'||row.city===city).map(row=>({label:String(row.city||'Not assigned'),value:finite(row.meanFirstResponseMinutes)?row.meanFirstResponseMinutes:null}));
 const currentOps=city==='all'?operations:rows(operations.byCity||operations.cities).find(row=>row.city===city)||{};
 const patternNames:Record<string,string>={multisignal:'Multiple signals',medication:'Medication',appetite:'Appetite / contact',mobility:'Mobility'};
 const patterns=rows(metrics.perPattern).map(row=>({label:patternNames[String(row.pattern)]||String(row.pattern),value:finite(row.recall)?row.recall*100:null,color:'#72946c'}));
 const review=obj(metrics.scenarioReviewCoverage),totalCases=count(metrics.totalCases),detected=count(metrics.detectedCases),reviewTotal=count(review.totalCases),reviewDetected=count(review.detectedCases);
 const needsAttention=selected.filter(s=>level(s)==='high'||s.urgency==='immediate').sort((a,b)=>(a.urgency==='immediate'?-1:0)-(b.urgency==='immediate'?-1:0)||(b.score??-1)-(a.score??-1)).slice(0,5);
 return <div className="outcomes-view">
  <section className="page-intro"><div><span className="eyebrow">CARE OVERVIEW</span><h1>Insights and outcomes</h1><p>Recorded priorities, follow-up activity and response times.</p></div><span className="outcomes-asof">As of {data.date?dateLabel(data.date):'current workspace date'}</span></section>
  <div className="outcomes-controls"><div className="outcomes-tabs" role="group" aria-label="Insights section"><button type="button" aria-pressed={tab==='care'} onClick={()=>setTab('care')}>Care outcomes</button><button type="button" aria-pressed={tab==='model'} onClick={()=>setTab('model')}>Model checks</button></div>{tab==='care'&&<label>City<select value={cities.includes(city)?city:'all'} onChange={event=>setCity(event.target.value)}><option value="all">All assigned cities</option>{cities.map(name=><option key={name}>{name}</option>)}</select></label>}</div>
  {tab==='care'?<>
   <div className="outcomes-totals"><div><span>Seniors in view</span><strong>{selected.length}</strong></div><div><span>High-priority reviews</span><strong>{levels.high}</strong></div><div><span>Follow-ups completed</span><strong>{taskCounts.done}<small> / {selectedTasks.length}</small></strong></div><div><span>Median first response</span><strong>{finite(currentOps.medianFirstResponseMinutes)?decimal(currentOps.medianFirstResponseMinutes)+' min':'Not recorded'}</strong></div></div>
   <div className="outcomes-chart-grid">
    <Figure title="Daily review priorities" description="The current priority of seniors in your assigned view."><Donut segments={priority} label="seniors"/></Figure>
    <Figure title="Priorities by city" description="Counts of high, medium, routine and unknown review priorities.">{cityMix.length?<CityMix cities={cityMix}/>:<p className="outcomes-empty">No assigned senior records are available.</p>}</Figure>
    <Figure title="Follow-up progress" description="Status of saved care actions, including actions still open."><Donut segments={taskSegments} label="actions"/></Figure>
    <Figure title="First response by city" description="Average minutes from an alert’s creation to its first recorded acknowledgment.">{responses.length?<HorizontalBars items={responses} unit=" min"/>:<p className="outcomes-empty">No acknowledgment timing is recorded yet.</p>}<p className="outcomes-chart-footnote">Missing acknowledgments do not count as a zero-minute response.</p></Figure>
    <Figure title="Daily score trend" description="Available dated scores for the seniors in this view." wide><RiskTrend seniors={selected}/></Figure>
   </div>
   {onOpenSenior&&needsAttention.length>0&&<section className="outcomes-attention"><div><h2>Reviews needing attention</h2><p>Open a senior to inspect the supporting evidence.</p></div><ul>{needsAttention.map(s=><li key={s.id}><button type="button" onClick={()=>onOpenSenior(s)}><span><strong>{s.name||s.id}</strong><small>{s.city||'City not assigned'}</small></span><span>{s.urgency==='immediate'?'Contact now':'Review today'} <i aria-hidden="true">↗</i></span></button></li>)}</ul></section>}
   <p className="outcomes-boundary">Risk scores guide care-team review. A completed task records a workflow outcome, rather than a medical all-clear.</p>
  </>:<>
   <div className="outcomes-model-intro"><h2>Synthetic scenario evaluation</h2><p>These checks use deliberately authored scenarios and separate senior identities. They do not establish clinical accuracy.</p></div>
   <div className="outcomes-chart-grid">
    <Figure title="Scenario-day coverage" description="Share of labelled scenario days receiving a high-priority flag.">{patterns.length?<HorizontalBars items={patterns} unit="%" percent/>:<p className="outcomes-empty">Pattern-level evaluation is not available.</p>}</Figure>
    <Figure title="Scenarios receiving a review flag" description="Case coverage at the existing review and high-priority thresholds."><HorizontalBars items={[{label:`Review (≥${count(review.threshold)||30})`,value:reviewTotal?reviewDetected/reviewTotal*100:null,color:'#55866b',detail:`${reviewDetected} of ${reviewTotal} synthetic cases`},{label:`High priority (≥${count(metrics.threshold)||60})`,value:totalCases?detected/totalCases*100:null,color:'#b77c5f',detail:`${detected} of ${totalCases} synthetic cases`}]} unit="%" percent/><p className="outcomes-chart-footnote">Review: {reviewDetected} / {reviewTotal} cases. High priority: {detected} / {totalCases} cases.</p></Figure>
   </div>
   <div className="outcomes-evaluation-notes"><div><h3>Detection after onset</h3><p>{finite(review.meanOnsetDetectionDelayDays)?`${decimal(review.meanOnsetDetectionDelayDays,2)} days on average at the review threshold.`:'Onset delay has not been measured.'} Earlier detection remains a goal.</p></div><div><h3>Clinical precision</h3><p>{typeof metrics.precisionLabel==='string'?metrics.precisionLabel:'Not established by these synthetic scenario checks.'}</p></div><div><h3>Recorded feedback</h3><p>{count(operations.usefulFeedback)} useful out of {count(operations.feedbackCount)} coordinator ratings. Collecting feedback alone does not demonstrate model improvement.</p></div></div>
   <details className="outcomes-method"><summary>Evaluation method and limits</summary><p>{typeof metrics.methodology==='string'?metrics.methodology:'Evaluation details are not currently available.'}</p></details>
  </>}
 </div>;
}
