"use client";
import {useMemo,useState} from 'react';
import {ResponsiveContainer,BarChart,Bar,CartesianGrid,XAxis,YAxis,Tooltip,Legend} from 'recharts';
import {medicationBuckets} from '../../lib/medication-chart-data.mjs';

type Point={date:string;hasMedication:boolean;taken:number|null;missed:number|null;unknown:number|null};
type Medicine={name:string;taken:number;missed:number;unknown:number};
type Snapshot={period:{days:number};points:Point[];medication:{loggedDays?:number;unloggedDays?:number;medicineOutcomes?:Medicine[];timingPatterns:{time:string;missedDoses:number;days:number}[]}};
const date=(value:string)=>new Date(value+'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'});
const colors={taken:'#35775a',missed:'#bd503f',unknown:'#9ba5af'};
function DoseBars(){return <><Bar dataKey="taken" name="Taken" stackId="dose" fill={colors.taken} isAnimationActive={false}/><Bar dataKey="missed" name="Missed" stackId="dose" fill={colors.missed} isAnimationActive={false}/><Bar dataKey="unknown" name="Not confirmed" stackId="dose" fill={colors.unknown} isAnimationActive={false}/></>;}

export default function MedicationCharts({snapshot}:{snapshot:Snapshot}){
 const [choice,setChoice]=useState<'day'|'week'|'month'|''>('');
 const group=choice||(snapshot.period.days===90?'week':'day');
 const series=useMemo(()=>medicationBuckets(snapshot.points,group),[snapshot.points,group]);
 const medicines=snapshot.medication.medicineOutcomes||[];
 const logged=snapshot.medication.loggedDays??snapshot.points.filter(p=>p.hasMedication).length;
 return <>
  <section className="panel monitor-chart medication-outcomes">
   <header><div><h2>Medication outcomes over time</h2><span>Number of logged doses · {logged}/{snapshot.period.days} days have a medication entry</span></div><label>Group by<select value={group} onChange={e=>setChoice(e.target.value as 'day'|'week'|'month')}><option value="day">Day</option><option value="week">Calendar week</option><option value="month">Calendar month</option></select></label></header>
   {logged>0?<div className="monitor-plot" role="img" aria-label={`Taken, missed and unconfirmed logged doses by ${group}. Empty periods have no medication log.`}><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={series} margin={{top:18,right:12,left:0,bottom:5}} maxBarSize={42} barCategoryGap="20%"><CartesianGrid vertical={false} strokeDasharray="3 3"/><XAxis dataKey="from" tickFormatter={date} minTickGap={32}/><YAxis allowDecimals={false} width={40}/><Tooltip labelFormatter={(_label,payload)=>{const p=payload?.[0]?.payload;return p?`${date(p.from)}${p.to!==p.from?' – '+date(p.to):''} · ${p.loggedDays}/${p.calendarDays} days logged`:'';}} formatter={(value,name)=>[`${value??0} doses`,name]}/><Legend/><DoseBars/></BarChart></ResponsiveContainer></div>:<p className="monitor-empty">No medication entries in this period. Add dated dose logs to see the chart.</p>}
   <p className="monitor-note">{snapshot.period.days-logged} days have no medication entry. Blank periods remain unobserved; they are not counted as missed doses. Weekly and monthly bars sum recorded doses only.</p>
  </section>
  <div className="monitor-grid">
   <section className="panel monitor-chart"><header><h2>Outcomes by medicine</h2><span>Explicit dose records only</span></header>{medicines.length?<div className="monitor-plot" style={{height:Math.max(230,medicines.length*46+60)}} role="img" aria-label="Taken, missed and unconfirmed dose records by medicine"><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart layout="vertical" data={medicines} margin={{top:8,right:12,left:0,bottom:5}} maxBarSize={30}><CartesianGrid horizontal={false} strokeDasharray="3 3"/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="name" width={112} tickFormatter={v=>String(v).length>17?String(v).slice(0,16)+'…':String(v)} interval={0}/><Tooltip/><Legend/><DoseBars/></BarChart></ResponsiveContainer></div>:<p className="monitor-empty">These records contain daily totals without medicine names. Per-medicine charts need named dose entries.</p>}</section>
   <section className="panel monitor-chart"><header><h2>Recurring missed times</h2><span>Misses on at least two logged days</span></header>{snapshot.medication.timingPatterns.length?<div className="monitor-plot" role="img" aria-label="Repeated missed doses grouped by recorded scheduled time"><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={snapshot.medication.timingPatterns} margin={{top:12,right:12,left:0,bottom:5}} maxBarSize={44}><CartesianGrid vertical={false} strokeDasharray="3 3"/><XAxis dataKey="time"/><YAxis width={40} allowDecimals={false}/><Tooltip formatter={(value,name)=>[`${value} doses`,name]}/><Bar dataKey="missedDoses" name="Recorded missed doses" fill={colors.missed} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>:<p className="monitor-empty">No repeated time pattern is supported by the available dose records.</p>}</section>
  </div>
 </>;
}
