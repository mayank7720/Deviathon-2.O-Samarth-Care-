import test from 'node:test';import assert from 'node:assert/strict';
import {reportPeriodEnd,prepareReportEvidence,validateReportAction} from '../lib/report-management.mjs';
import {handleReportRoute} from '../lib/report-routes.mjs';
import {reportExportText} from '../lib/report-export.mjs';
const id='11111111-1111-4111-8111-111111111111',family='22222222-2222-4222-8222-222222222222';
const input={action:'note',reportId:'report:fixture:'+id,revision:0,idempotencyKey:id,note:'Checked source entries.'};
test('report actions require saved IDs, revisions, review checklist and selected accounts, never raw addresses',()=>{
 assert.equal(validateReportAction(input).note,'Checked source entries.');
 for(const patch of[{revision:-1},{revision:1.5},{idempotencyKey:'invalid'},{action:'delete'},{phone:'+19990000001'},{note:'x'.repeat(2001)}])assert.throws(()=>validateReportAction({...input,...patch}));
 for(const action of['reject','withdraw']){assert.throws(()=>validateReportAction({...input,action,note:'no'}));assert.doesNotThrow(()=>validateReportAction({...input,action,note:'Reason recorded.'}));}
 const checks={evidence:true,uncertainty:true,noDiagnosis:true};assert.doesNotThrow(()=>validateReportAction({...input,action:'review',checks}));assert.throws(()=>validateReportAction({...input,action:'review',checks:{...checks,noDiagnosis:false}}));
 assert.doesNotThrow(()=>validateReportAction({...input,action:'share',recipientIds:[family]}));
 for(const recipientIds of[[],[family,family],['+19990000001'],Array.from({length:21},(_,n)=>family.slice(0,-2)+String(n).padStart(2,'0'))])assert.throws(()=>validateReportAction({...input,action:'share',recipientIds}));
 const {note,...withoutNote}=input;assert.equal('note' in validateReportAction(withoutNote),false);
});
test('weekly period selection rejects future, impossible and pre-history dates',()=>{
 assert.equal(reportPeriodEnd('', '2026-10-31','2026-08-02'),'2026-10-31');
 assert.equal(reportPeriodEnd('2026-10-24','2026-10-31','2026-08-02'),'2026-10-24');
 for(const date of['2026-11-01','2026-02-30','invalid','2026-01-01'])assert.throws(()=>reportPeriodEnd(date,'2026-10-31','2026-08-02'));
});
test('evidence preview is exactly seven days, preserves unknowns and excludes future/other senior records',async()=>{
 const senior={id:'S001',level:'high',urgency:'immediate',baseline:{systolic:110}},records=[{seniorId:'S001',date:'2026-10-23',vitals:{systolic:125}},{seniorId:'S001',date:'2026-10-24',medication:{prescribed:2,taken:1},note:'Pain reported'},{seniorId:'S001',date:'2026-10-25',vitals:{systolic:220}},{seniorId:'S002',date:'2026-10-24',vitals:{systolic:280}}];
 const r=await prepareReportEvidence({senior,records,endDate:'2026-10-24',asOfDate:'2026-10-31',cohortStart:'2026-08-02',dataKind:'synthetic'});
 assert.deepEqual(r.preview.period,{from:'2026-10-18',to:'2026-10-24',days:7});assert.equal(r.preview.observedDays,2);assert.equal(r.preview.missingDays,5);assert.equal(r.preview.evidenceEntries,2);assert.equal(r.subject.level,'unknown');assert.equal(r.facts.statements.some(s=>s.kind==='personal_comparison'),false);assert.equal(r.preview.domains.find(d=>d.label==='Medication').entries,1);assert.equal(r.factsHash.length,64);assert.ok(r.preview.warnings.length);
 const empty=await prepareReportEvidence({senior,records:[],endDate:'2026-10-31',asOfDate:'2026-10-31'});assert.equal(empty.preview.evidenceEntries,0);assert.match(empty.preview.warnings[0],/No usable/);
});
test('management API denies personal roles and forwards only validated staff actions to durable storage',async()=>{
 const calls=[],db={reportManagement:async(action,payload)=>{calls.push({action,payload});return{ok:true,revision:1};}};
 const run=role=>handleReportRoute({path:'reports/manage',request:new Request('https://care.example/api/reports/manage',{method:'POST'}),body:input,db,context:{session:{role,isAdmin:role==='operations'}}});
 for(const role of['senior','family'])assert.equal((await run(role)).status,403);
 assert.equal((await run('coordinator')).status,200);assert.equal(calls[0].action,'note');assert.equal(calls[0].payload.reportId,input.reportId);
 assert.equal((await run('operations')).status,200);
});

test('summary exports use real line breaks and exclude internal notes, audit rows and recipient contacts',()=>{
 const report={text:'Supported report text.',period:{from:'2026-10-24',to:'2026-10-30'},generation:{llmUsed:true},review:{note:'PRIVATE REVIEWER NOTE',recipients:[{name:'PRIVATE FAMILY NAME',phone:'+19990000001'}]}};
 const result=reportExportText('Selected senior',report,'Needs review','31 Oct 2026');
 assert.ok(result.split('\n').length>5);assert.match(result,/Supported report text/);assert.doesNotMatch(result,/PRIVATE|19990000001|\\n/);
});
