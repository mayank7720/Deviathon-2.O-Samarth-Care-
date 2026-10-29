import {validDate,TIMEZONE} from './runtime.mjs';
import {scanEvents} from './workflow-store.mjs';
import {compareObservations} from './observation-merge.mjs';
import {MODEL_INFO} from './engine.mjs';

const DAY=86400000;
const add=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const dayCount=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/DAY)+1;
class HistoryError extends Error {constructor(status,message){super(message);this.status=status;}}
const check=(c,s,m)=>{if(!c)throw new HistoryError(s,m);};
export function historyOptions(url,asOfDate) {
  const query=new URL(url).searchParams;
  const from=query.get('from')||add(asOfDate,-29),to=query.get('to')||asOfDate,groupBy=query.get('groupBy')||'day';
  check(validDate(from)&&validDate(to)&&from<=to,400,'Choose a valid date range.');
  check(to<=asOfDate,400,'History cannot include days after the workspace date.');
  check(dayCount(from,to)<=366,400,'Choose a date range of at most 366 days.');
  check(['day','week','month'].includes(groupBy),400,'Group history by day, week or month.');
  const raw=query.get('limit')||'50';check(/^\d+$/.test(raw)&&+raw>=1&&+raw<=200,400,'Choose a page size between 1 and 200.');
  let cursor=null;
  if(query.has('cursor')){
    try{cursor=JSON.parse(decodeURIComponent(query.get('cursor')));}catch{throw new HistoryError(400,'This history page link is invalid.');}
    check(cursor&&validDate(cursor.date)&&((Number.isSafeInteger(cursor.sequence)&&cursor.sequence>=0)||(typeof cursor.sequence==='string'&&/^\d{1,18}$/.test(cursor.sequence))),400,'This history page link is invalid.');
    check(cursor.observedAt==null||typeof cursor.observedAt==='string'&&Number.isFinite(Date.parse(cursor.observedAt)),400,'This history page link is invalid.');
    check(cursor.date>=from&&cursor.date<=to,400,'This history page belongs to another date range.');
  }
  return {from,to,asOfDate,groupBy,limit:+raw,cursor,timezone:TIMEZONE};
}
function bucketStart(date,groupBy){
  if(groupBy==='month')return date.slice(0,7)+'-01';
  if(groupBy==='week'){const weekday=new Date(date+'T00:00:00Z').getUTCDay();return add(date,-((weekday+6)%7));}
  return date;
}
/** Local fixture mode has the same history contract as hosted storage. */
export function fixtureHistory({cohort,engine,seniorId,options,signals=[]}) {
  const {from,to,groupBy,limit,cursor}=options;
  const raw=[...cohort.records.filter(r=>r.seniorId===seniorId).map(r=>({...r,synthetic:true})),...signals];
  const entries=raw.filter(r=>r.seniorId===seniorId&&r.date>=from&&r.date<=to).map((r,i)=>({id:r.id||`fixture:${seniorId}:${r.date}:${i}`,seniorId,date:r.date,observedAt:r.observedAt??null,timePrecision:r.observedAt?r.timePrecision||'second':'day',recordedAt:r.recordedAt??null,source:r.source||'recorded',synthetic:r.synthetic===true||r.provenance?.synthetic===true,sequence:i+1,record:r}));
  const grouped=new Map();
  for(let date=from;date<=to;date=add(date,1)){
    const key=bucketStart(date,groupBy),prior=grouped.get(key);
    if(!prior)grouped.set(key,{from:date,to:date,daysExpected:0,dates:new Set(),entries:[]});
    const bucket=grouped.get(key);bucket.to=date;bucket.daysExpected++;
  }
  for(const e of entries){const b=grouped.get(bucketStart(e.date,groupBy));b.dates.add(e.date);b.entries.push(e);}
  const buckets=[...grouped.values()].map(b=>{
    const vitals={};
    for(const field of ['systolic','diastolic','glucose','spo2','weight']){
      const v=b.entries.filter(e=>!e.synthetic||!b.entries.some(actual=>!actual.synthetic&&actual.date===e.date&&Number.isFinite(actual.record.vitals?.[field]))).map(e=>e.record.vitals?.[field]).filter(Number.isFinite);
      if(v.length)vitals[field]={count:v.length,mean:Math.round(v.reduce((a,c)=>a+c,0)/v.length*10)/10,min:Math.min(...v),max:Math.max(...v)};
    }
    const medications=new Map();
    const medicationEntries=b.entries.filter(e=>e.record.medication).sort((a,b)=>a.date.localeCompare(b.date)||Number(b.synthetic)-Number(a.synthetic)||compareObservations({...a.record,recordedAt:a.recordedAt},{...b.record,recordedAt:b.recordedAt}));
    for(const e of medicationEntries)medications.set(e.date,e.record.medication);
    const scheduled=[...medications.values()].reduce((a,m)=>a+(m.prescribed||0),0),taken=[...medications.values()].reduce((a,m)=>a+(m.taken||0),0);
    const missed=[...medications.values()].reduce((n,m)=>n+(m.doses?.length?m.doses.filter(d=>d.status==='missed').length:Math.max(0,m.prescribed-m.taken)),0),unknown=[...medications.values()].reduce((n,m)=>n+(m.doses?.filter(d=>d.status==='unknown').length||0),0);
    return {from:b.from,to:b.to,daysExpected:b.daysExpected,daysObserved:b.dates.size,records:b.entries.length,missingDays:b.daysExpected-b.dates.size,vitals,medication:{scheduled,taken,missed,unknown,daysLogged:medications.size},notesCount:b.entries.filter(e=>e.record.note).length};
  });
  const measurement=e=>e.observedAt?new Date(e.observedAt).toISOString():'';
  entries.sort((a,b)=>b.date.localeCompare(a.date)||measurement(b).localeCompare(measurement(a))||b.sequence-a.sequence);
  const filtered=cursor?entries.filter(e=>e.date<cursor.date||e.date===cursor.date&&(measurement(e)<measurement(cursor)||measurement(e)===measurement(cursor)&&e.sequence<cursor.sequence)):entries;
  const page=filtered.slice(0,limit),hasMore=filtered.length>limit,last=page.at(-1);
  const risk=[];for(let date=from;date<=to;date=add(date,1)){const s=engine.scoreSenior(seniorId,date,signals);risk.push({date,score:s.score,level:s.level,urgency:s.urgency,synthetic:true});}
  return {range:options,entries:page,buckets,risk,nextCursor:hasMore?{date:last.date,observedAt:last.observedAt,sequence:last.sequence}:null,dataset:{synthetic:true,version:cohort.metadata.generator||'legacy',from:cohort.metadata.startDate,to:cohort.metadata.endDate,storage:'local_fixture'}};
}
export function normaliseHistory(raw,options) {
  const buckets=(raw.buckets||[]).map(b=>({
    ...b,calendarDays:b.daysExpected??b.calendarDays??dayCount(b.from,b.to),observedDays:b.daysObserved??b.observedDays??0,observationCount:b.records??b.observationCount??0,
    medication:{...b.medication,prescribed:b.medication?.scheduled??b.medication?.prescribed??0,taken:b.medication?.taken??0,adherence:(b.medication?.scheduled??b.medication?.prescribed)>0?Math.round(b.medication.taken/(b.medication.scheduled??b.medication.prescribed)*100):null},
    notesCount:b.notesCount??0
  }));
  return {range:{...raw.range,from:options.from,to:options.to,asOfDate:options.asOfDate,groupBy:options.groupBy,timezone:TIMEZONE},entries:raw.entries||[],buckets,risk:raw.risk||[],dataset:raw.dataset?{...raw.dataset,version:raw.dataset.version||raw.dataset.generator}:null,rebuildPending:raw.rebuildPending===true,
    pagination:{hasMore:!!raw.nextCursor,nextCursor:raw.nextCursor?encodeURIComponent(JSON.stringify(raw.nextCursor)):null},
    coverage:{calendarDays:dayCount(options.from,options.to),observedDays:buckets.reduce((n,b)=>n+b.observedDays,0),observationCount:buckets.reduce((n,b)=>n+b.observationCount,0)}};
}
export async function handleHistoryRoute({path,request,db,context,runtime,cohort,engine}) {
  const match=path.match(/^history\/(S\d{3,6})$/);if(!match)return null;
  const {session,owner}=context;
  check(request.method==='GET',405,'History supports read requests only.');
  check(['coordinator','operations'].includes(session.role),403,'Detailed care history is available to the care team.');
  const seniorId=match[1];
  check(session.scope?.includes('*')||session.scope?.includes(seniorId),403,'This senior is outside your assigned care scope.');
  check(cohort.seniors.some(s=>s.id===seniorId),404,'Senior not found.');
  const options=historyOptions(request.url,runtime.date);
  let data;
  if(db.backend==='supabase'){
    check(typeof db.history==='function',503,'Care history storage is unavailable.');
    data=await db.history({...options,seniorId});
    if(cohort.seniors.find(s=>s.id===seniorId)?.dataProvenance?.kind==='recorded')data={...data,dataset:null};
  }else{
    const rows=await scanEvents(db,{owner,seniorIds:[seniorId],kinds:['signal'],sinceRecordDate:options.from});
    data=fixtureHistory({cohort,engine,seniorId,options,signals:rows.map(r=>{const p=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;return {...p.record,id:r.id,recordedAt:r.created_at,synthetic:false};})});
  }
  return new Response(JSON.stringify(normaliseHistory(data,options)),{headers:{'content-type':'application/json','cache-control':'no-store'}});
}

/** Recompute only the affected senior, preserving daily cache and historic archive independently. */
export async function refreshScoreHistory({db,engine,rows,seniorId,from,to,cohortStart,watermark}){
  if(typeof db.historyScores!=='function'||!seniorId)return;
  const start=from<cohortStart?cohortStart:from;
  check(dayCount(start,to)<=366,400,'This history update needs a bounded recomputation.');
  const extra=rows.filter(r=>r.kind==='signal'&&r.seniorId===seniorId).map(r=>({...r.record,id:r.id,recordedAt:r.createdAt}));
  const scores=[];for(let date=start;date<=to;date=add(date,1)){
    const scored=engine.scoreSenior(seniorId,date,extra);
    scores.push({date,score:scored.score,level:scored.level,urgency:scored.urgency,reasons:scored.reasons,action:scored.action,modelVersion:MODEL_INFO.version,synthetic:false});
  }
  const bytes=new TextEncoder().encode(JSON.stringify(extra.map(r=>[r.id,r.date,r.observedAt,r.recordedAt])));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  await db.historyScores({seniorId,from:start,to,scores,revision:`history-v1:${MODEL_INFO.version}:${hash}`,...(watermark!=null?{watermark}:{})});
}
