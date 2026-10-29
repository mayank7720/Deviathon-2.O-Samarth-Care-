import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {scanEvents,scanLatestEvents} from '../lib/workflow-store.mjs';
import {mergeDailyObservations} from '../lib/observation-merge.mjs';
import {createEngine,generateCohort,DEMO_DATE} from '../lib/engine.mjs';
import {analyzeSenior} from '../lib/analytics.mjs';

test('indexed history drains more than 5000 events including equal-time page boundaries',async t=>{
 const db=new LocalD1();t.after(()=>db.close());
 const insert=db.db.prepare('INSERT INTO care_events(id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)');
 db.db.exec('BEGIN');
 for(let i=0;i<6101;i++)insert.run(`signal-${i}`,'workspace:primary','signal','S001',JSON.stringify({record:{date:'2026-10-29'}}),'2026-10-29T12:00:00.000Z');
 for(let i=0;i<5100;i++)insert.run(`heartbeat-${i}`,'workspace:primary','telephony_bridge','','{}','2026-10-29T13:00:00.000Z');
 insert.run('other-senior','workspace:primary','signal','S002','{}','2026-10-29T12:00:00.000Z');db.db.exec('COMMIT');
 const rows=await scanEvents(db,{owner:'workspace:primary',seniorIds:['S001'],kinds:['signal'],limit:1000});
 assert.equal(rows.length,6101);assert.equal(rows[0].id,'signal-0');assert.equal(rows.at(-1).id,'signal-6100');
 assert.equal(new Set(rows.map(row=>row.id)).size,6101);
 const latest=await scanLatestEvents(db,{owner:'workspace:primary',seniorIds:['S001'],kinds:['telephony_bridge'],limit:1});
 assert.equal(latest.length,1);assert.equal(latest[0].id,'heartbeat-5099');
});

test('RPC pagination carries both cursor fields and fails on a repeated page',async()=>{
 const calls=[],records=Array.from({length:7},(_,i)=>({id:`e${i}`,sequence:7-i,created_at:'2026-10-29T00:00:00Z'}));
 const db={async scanEvents(options){calls.push(options);const start=options.beforeSequence?records.findIndex(row=>String(row.sequence)===String(options.beforeSequence))+1:0;return {results:records.slice(start,start+options.limit)};}};
 const rows=await scanEvents(db,{owner:'workspace:primary',seniorIds:['S001'],kinds:['signal'],limit:3});
 assert.equal(rows.length,7);assert.equal(calls[1].beforeSequence,'5');assert.equal(calls[1].beforeCreatedAt,records[0].created_at);
 await assert.rejects(()=>scanEvents({scanEvents:async()=>({results:records.slice(0,3)})},{limit:3}),error=>error.status===503&&/repeated/.test(error.message));
});

test('same-day records use measurement time rather than arrival order, retain every raw input, and do not double count totals',()=>{
 const early={id:'morning',seniorId:'S001',date:DEMO_DATE,observedAt:DEMO_DATE+'T03:00:00Z',recordedAt:DEMO_DATE+'T13:00:00Z',vitals:{systolic:150,spo2:97},medication:{taken:1,prescribed:3},note:'Morning note.'};
 const late={id:'evening',seniorId:'S001',date:DEMO_DATE,observedAt:DEMO_DATE+'T12:00:00Z',recordedAt:DEMO_DATE+'T12:05:00Z',vitals:{systolic:130},medication:{taken:2,prescribed:3},note:'Evening note.'};
 const records=[late,early],original=structuredClone(records),daily=mergeDailyObservations(records,{seniorId:'S001',asOfDate:DEMO_DATE});
 assert.deepEqual(records,original);assert.equal(daily[0].vitals.systolic,130);assert.equal(daily[0].vitals.spo2,97);
 assert.deepEqual(daily[0].medication,{taken:2,prescribed:3});assert.equal(daily[0].observationCount,2);
 assert.equal(daily[0].note,'Morning note.\nEvening note.');assert.equal(daily[0].vitalSources.systolic.id,'evening');
 assert.deepEqual(daily,mergeDailyObservations([early,late],{seniorId:'S001',asOfDate:DEMO_DATE}));
});

test('day-only records keep unknown time and cannot silently displace an explicitly timed reading',()=>{
 const [daily]=mergeDailyObservations([
  {id:'timed',seniorId:'S001',date:DEMO_DATE,observedAt:DEMO_DATE+'T08:00:00Z',vitals:{spo2:95}},
  {id:'unknown',seniorId:'S001',date:DEMO_DATE,recordedAt:DEMO_DATE+'T18:00:00Z',timePrecision:'day',vitals:{spo2:98,systolic:126}},
 ],{seniorId:'S001',asOfDate:DEMO_DATE});
 assert.equal(daily.vitals.spo2,95);assert.equal(daily.vitalSources.spo2.observedAt,DEMO_DATE+'T08:00:00Z');
 assert.equal(daily.vitalSources.systolic.observedAt,null);assert.equal(daily.vitalSources.systolic.timePrecision,'day');
});

test('a later normal reading does not erase an earlier urgent same-day reading from score or analytics',()=>{
 const cohort=generateCohort(),engine=createEngine(cohort),records=[
  {id:'earlier-low',seniorId:'S101',date:DEMO_DATE,observedAt:DEMO_DATE+'T02:00:00Z',vitals:{spo2:87}},
  {id:'later-normal',seniorId:'S101',date:DEMO_DATE,observedAt:DEMO_DATE+'T12:00:00Z',vitals:{spo2:98}},
 ];
 const result=engine.scoreSenior('S101',DEMO_DATE,records);
 assert.equal(result.latest.vitals.spo2,98);assert.equal(result.urgency,'immediate');assert.ok(result.score>=60);
 assert.ok(result.triageEvidence.some(entry=>/87/.test(entry.detail)));
 const analysis=analyzeSenior(result,[...cohort.records.filter(record=>record.seniorId==='S101'),...records]);
 assert.equal(analysis.urgency,'immediate');assert.equal(analysis.domains.find(domain=>domain.id==='oxygen').level,'high');
});
