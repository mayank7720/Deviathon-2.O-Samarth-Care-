import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observationTime} from '../lib/observation-time.mjs';
import {historyOptions,fixtureHistory,normaliseHistory,handleHistoryRoute} from '../lib/history.mjs';

const now=new Date('2026-10-29T12:00:00Z');
const clock={asOfDate:'2026-10-29',cohortStart:'2026-08-01',now};
test('measurement date, exact time, unknown time and saved time are distinct',()=>{
 assert.deepEqual(observationTime({date:'2026-10-10'},clock),{date:'2026-10-10',observedAt:null,timePrecision:'day',timezone:'Asia/Kolkata'});
 const result=observationTime({date:'2026-10-10',observationTime:'08:45'},clock);
 assert.equal(result.observedAt,'2026-10-10T03:15:00.000Z');assert.equal(result.timePrecision,'minute');assert.equal(result.date,'2026-10-10');
 assert.throws(()=>observationTime({date:'2026-10-10',observedAt:'2026-10-11T08:00:00Z'},clock),/selected date/);
 assert.throws(()=>observationTime({date:'2026-10-29',observationTime:'23:59'},clock),/future/);
 assert.throws(()=>observationTime({date:'2026-10-30'},clock),/workspace/);
 assert.throws(()=>observationTime({date:'2026-09-31'},clock),/valid observation date/);
 assert.throws(()=>observationTime({date:'2026-10-10',observedAt:'2026-10-10T08:00'},clock),/timezone offset/);
 assert.throws(()=>observationTime({date:'2026-10-10',timezone:'UTC'},clock),/Asia\/Kolkata/);
});
test('history filters cannot exceed workspace date, invalid dates, or bounded range',()=>{
 const options=historyOptions('http://localhost/api/history/S001?from=2026-08-01&to=2026-10-29&groupBy=month','2026-10-29');
 assert.equal(options.from,'2026-08-01');assert.equal(options.to,'2026-10-29');assert.equal(options.groupBy,'month');
 for(const query of ['from=2026-08-01&to=2026-10-30','from=2026-09-31&to=2026-10-29','from=2020-01-01&to=2026-10-29','groupBy=year','limit=0','cursor=%7B%7D'])assert.throws(()=>historyOptions('http://localhost/api/history/S001?'+query,'2026-10-29'));
});
test('calendar months aggregate independent of raw pagination and preserve same-day readings',()=>{
 const cohort={metadata:{startDate:'2026-08-01',endDate:'2026-10-29',generator:'test'},records:[
  {id:'a',seniorId:'S001',date:'2026-08-01',vitals:{systolic:120}},
  {id:'b',seniorId:'S001',date:'2026-09-01',vitals:{systolic:130}},
  {id:'c',seniorId:'S001',date:'2026-10-29',medication:{prescribed:3,taken:2}}
 ]};
 const engine={scoreSenior:(_id,date)=>({score:date<'2026-09-01'?null:30,level:date<'2026-09-01'?'unknown':'medium',urgency:'review'})};
 const options=historyOptions('http://localhost/api/history/S001?from=2026-08-01&to=2026-10-29&groupBy=month&limit=1','2026-10-29');
 const signals=[{id:'d',seniorId:'S001',date:'2026-10-29',observedAt:'2026-10-29T03:00:00Z',vitals:{systolic:140},recordedAt:'2026-10-29T03:01:00Z'}];
 const first=fixtureHistory({cohort,engine,seniorId:'S001',options,signals}),normal=normaliseHistory(first,options);
 assert.equal(normal.entries.length,1);assert.equal(normal.pagination.hasMore,true);
 assert.equal(normal.buckets.length,3);assert.equal(normal.coverage.calendarDays,90);assert.equal(normal.coverage.observedDays,3);assert.equal(normal.coverage.observationCount,4);
 assert.equal(normal.buckets[2].medication.adherence,67);assert.equal(normal.risk.length,90);assert.equal(normal.risk[0].score,null);
 assert.equal(first.entries[0].observedAt,'2026-10-29T03:00:00Z');
 const next=fixtureHistory({cohort,engine,seniorId:'S001',options:{...options,cursor:first.nextCursor},signals});
 assert.notEqual(next.entries[0].id,first.entries[0].id);
 assert.equal(next.buckets[2].records,2);
 const historical=fixtureHistory({cohort,engine,seniorId:'S001',options:{...options,to:'2026-09-01'},signals});
 assert.ok(historical.entries.every(e=>e.date<='2026-09-01'));
});
test('raw history denies family users and staff outside their assignment before DB access',async()=>{
 const base={path:'history/S002',request:new Request('https://example.test/api/history/S002'),db:{backend:'supabase',history(){assert.fail('Should never touch storage');}},runtime:{date:'2026-10-29'},cohort:{seniors:[{id:'S002'}]}};
 for(const session of [{role:'family',scope:['S002']},{role:'coordinator',scope:['S001']}])await assert.rejects(handleHistoryRoute({...base,context:{session,owner:'workspace:primary'}}),e=>e.status===403);
});
test('local summaries match submitted-over-synthetic aggregation and keep unknown doses separate',()=>{
 const cohort={metadata:{startDate:'2026-10-29',endDate:'2026-10-29'},records:[{id:'baseline',seniorId:'S001',date:'2026-10-29',vitals:{systolic:120,weight:70},medication:{taken:3,prescribed:3}}]};
 const options=historyOptions('http://localhost/api/history/S001?from=2026-10-29&to=2026-10-29','2026-10-29');
 const engine={scoreSenior:()=>({score:5,level:'low'})};
 const signals=[{id:'later',seniorId:'S001',date:'2026-10-29',observedAt:'2026-10-29T08:00:00Z',vitals:{systolic:140},medication:{taken:1,prescribed:2,doses:[{status:'taken'},{status:'unknown'}]}},{id:'earlier',seniorId:'S001',date:'2026-10-29',observedAt:'2026-10-29T03:00:00Z',vitals:{systolic:130},medication:{taken:2,prescribed:2}}];
 const result=fixtureHistory({cohort,engine,seniorId:'S001',options,signals}),bucket=result.buckets[0];
 assert.equal(bucket.vitals.systolic.mean,135);assert.equal(bucket.vitals.systolic.count,2);assert.equal(bucket.vitals.weight.mean,70);
 assert.equal(bucket.medication.taken,1);assert.equal(bucket.medication.scheduled,2);assert.equal(bucket.medication.missed,0);assert.equal(bucket.medication.unknown,1);
 assert.equal(result.entries[0].id,'later');assert.equal(result.entries[1].id,'earlier');assert.equal(result.entries[2].id,'baseline');
 assert.equal(normaliseHistory({...result,rebuildPending:true},options).rebuildPending,true);
 const cursor=encodeURIComponent(JSON.stringify({date:'2026-10-29',observedAt:'2026-10-29T03:00:00+00:00',sequence:'42'}));
 assert.equal(historyOptions('http://localhost/api/history/S001?from=2026-10-29&to=2026-10-29&cursor='+encodeURIComponent(cursor),'2026-10-29').cursor.sequence,'42');
});
