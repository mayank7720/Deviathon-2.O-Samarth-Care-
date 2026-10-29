import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalysisRoute } from '../lib/analysis-routes.mjs';
import { DEMO_DATE } from '../lib/engine.mjs';

function fixture({ role = 'coordinator', scope = ['*'], consent = true, admin = false } = {}) {
  const rows = [];
  const profiles = [
    { id: 'S001', name: 'Fictional One', score: 35, level: 'medium' },
    { id: 'S002', name: 'Fictional Two', score: 72, level: 'high' },
    { id: 'S003', name: 'Fictional Three', score: 10, level: 'low' },
  ].map((senior) => ({
    ...senior, city: 'Pune', familyConsent: consent, cues: [],
    baseline: { systolic: 125, diastolic: 78, glucose: 110, spo2: 98, weight: 65, activity: 4000, sleep: 7 },
    latest: { date: DEMO_DATE, vitals: { systolic: 130, diastolic: 80, spo2: 98, glucose: 112 }, note: 'Private source note: no pain.' },
    lastCheckIn: DEMO_DATE, confidence: 90,
    reasons: [{ title: 'Medicine routine changed', detail: 'Private clinical raw note', source: 'medication' }],
    action: 'Arrange a care-team check-in.',
    trend: Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${21 + index}`, score: senior.score })),
  }));
  const context = { owner: 'workspace:primary', session: { role, name: 'Test care member', userId: 'TEST', seniorId: ['family', 'senior'].includes(role) ? 'S002' : null, scope, isAdmin: admin } };
  if (['family', 'senior'].includes(role) && scope[0] === '*') context.session.scope = ['S002'];
  const cohort = {
    seniors: profiles,
    records: profiles.flatMap((senior) => Array.from({ length: 7 }, (_, index) => ({ seniorId: senior.id, date: `2026-10-${21 + index}`, medication: { prescribed: 3, taken: 3 }, activity: 4000, sleep: 7, vitals: { systolic: 130, diastolic: 80, spo2: 98, glucose: 112, weight: 65 }, note: 'Feeling well. No pain or confusion.' }))),
  };
  const getSenior = (id) => {
    if (!context.session.scope.includes('*') && !context.session.scope.includes(id) && context.session.seniorId !== id) throw Object.assign(new Error('Outside assigned care scope.'), { status: 403 });
    const senior = profiles.find((profile) => profile.id === id);
    if (!senior) throw Object.assign(new Error('Senior not found.'), { status: 404 });
    return senior;
  };
  const storeMutation = async (_db, owner, kind, seniorId, payload, actor) => {
    assert.equal(owner, 'workspace:primary');
    rows.push({ id: `EVENT-${rows.length}`, kind, seniorId, ...payload, actor, createdAt: new Date().toISOString() });
  };
  const call = async (path, { method = 'GET', body = {}, ...routeOptions } = {}) => {
    const response = await handleAnalysisRoute({ path, request: new Request(`http://localhost/api/${path}`, { method }), body, db: {}, context, rows, cohort, engine: { rankSeniors: () => profiles }, getSenior, storeMutation, ...routeOptions });
    return response ? { status: response.status, data: await response.json() } : null;
  };
  return { rows, profiles, context, call };
}

test('analysis and summary routes enforce staff scope and linked-family consent', async () => {
  const staff = fixture({ scope: ['S001'] });
  assert.equal((await staff.call('analysis/S001')).status, 200);
  assert.equal((await staff.call('analysis/S002')).status, 403);
  const family = fixture({ role: 'family' });
  assert.equal((await family.call('analysis/S002')).status, 403);
  assert.equal((await family.call('summaries/S001')).status, 403);
  assert.equal((await family.call('summaries/S002')).status, 200);
  family.profiles[1].familyConsent = false;
  assert.equal((await family.call('summaries/S002')).status, 403);
  assert.equal((await family.call('alerts')).status, 403);
});

test('senior gets only their own gentle summary and prompt', async () => {
  const app = fixture({ role: 'senior' });
  const summary = await app.call('summaries/S002');
  assert.equal(summary.status, 200);
  assert.equal(summary.data.summary.method, 'local extractive');
  assert.equal((await app.call('summaries/S001')).status, 403);
  const result = await app.call('alerts');
  assert.equal(result.data.alerts.length, 1);
  assert.equal(result.data.alerts[0].score, undefined);
  assert.equal(result.data.alerts[0].reasons, undefined);
  assert.match(result.data.alerts[0].title, /care team/);
});

test('daily alerts are deduplicated, sorted and respect assigned care scope', async () => {
  const app = fixture({ scope: ['S001', 'S002'] });
  const result = await app.call('alerts');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.alerts.map((alert) => alert.id), [`A-S002-${DEMO_DATE}`, `A-S001-${DEMO_DATE}`]);
  assert.equal(new Set(result.data.alerts.map((alert) => alert.seniorId)).size, result.data.alerts.length);
  assert.equal(result.data.counts.open, 2);
  assert.equal(result.data.policy.minimumScore, 30);
});

test('low-scoring help requests and severe submitted signals bypass thresholds', async () => {
  const app = fixture({ admin: true });
  assert.equal((await app.call('alerts/policy', { method: 'POST', body: { minimumScore: 60, cooldownHours: 24 } })).status, 200);
  let result = await app.call('alerts');
  assert.deepEqual(result.data.alerts.map((alert) => alert.seniorId), ['S002']);
  app.rows.push({ id: 'HELP-1', kind: 'signal', seniorId: 'S003', mood: 'help', record: { seniorId: 'S003', date: DEMO_DATE, note: 'Please call me.' } });
  result = await app.call('alerts');
  const alert = result.data.alerts.find((item) => item.seniorId === 'S003');
  assert.equal(alert.urgent, true);
  assert.equal(alert.level, 'high');
  assert.equal(alert.score, 10);
  assert.match(alert.title, /requested/);
});

test('alert lifecycle persists acknowledgment and requires a meaningful resolution outcome', async () => {
  const app = fixture();
  const id = `A-S001-${DEMO_DATE}`;
  assert.equal((await app.call(`alerts/${id}`, { method: 'PATCH', body: { status: 'acknowledged' } })).status, 200);
  assert.equal((await app.call('alerts')).data.alerts.find((alert) => alert.id === id).status, 'acknowledged');
  assert.equal((await app.call(`alerts/${id}`, { method: 'PATCH', body: { status: 'resolved', outcome: 'ok' } })).status, 400);
  assert.equal((await app.call(`alerts/${id}`, { method: 'PATCH', body: { status: 'resolved', outcome: 'Called senior; visit arranged.' } })).status, 200);
  const resolved = (await app.call('alerts')).data.alerts.find((alert) => alert.id === id);
  assert.equal(resolved.status, 'resolved');
  assert.match(resolved.outcome, /visit arranged/);
});

test('urgent alerts cannot be snoozed and new urgent evidence reopens a resolved state', async () => {
  const app = fixture();
  app.rows.push({ id: 'FALL-1', kind: 'signal', seniorId: 'S001', record: { seniorId: 'S001', date: DEMO_DATE, note: 'Had a fall this morning.' } });
  const id = `A-S001-${DEMO_DATE}`;
  assert.equal((await app.call(`alerts/${id}`, { method: 'PATCH', body: { status: 'snoozed', snoozeHours: 2 } })).status, 409);
  assert.equal((await app.call(`alerts/${id}`, { method: 'PATCH', body: { status: 'resolved', outcome: 'Assessed by care team; follow-up arranged.' } })).status, 200);
  let alert = (await app.call('alerts')).data.alerts.find((item) => item.id === id);
  assert.equal(alert.status, 'resolved');
  app.rows.push({ id: 'FALL-2', kind: 'signal', seniorId: 'S001', record: { seniorId: 'S001', date: DEMO_DATE, note: 'Fell again this evening.' } });
  alert = (await app.call('alerts')).data.alerts.find((item) => item.id === id);
  assert.equal(alert.status, 'open');
  assert.equal(alert.reopened, true);
});

test('non-urgent snoozes expire and severe new readings immediately reopen them', async () => {
  const app = fixture(); const id = `A-S001-${DEMO_DATE}`;
  assert.equal((await app.call(`alerts/${id}`, { method: 'PATCH', body: { status: 'snoozed', snoozeHours: 3 } })).status, 200);
  assert.equal((await app.call('alerts')).data.alerts.find((alert) => alert.id === id).status, 'snoozed');
  app.rows.at(-1).snoozedUntil = new Date(Date.now() - 60000).toISOString();
  assert.equal((await app.call('alerts')).data.alerts.find((alert) => alert.id === id).status, 'open');
  await app.call(`alerts/${id}`, { method: 'PATCH', body: { status: 'snoozed', snoozeHours: 3 } });
  app.rows.push({ id: 'READING-1', kind: 'signal', seniorId: 'S001', record: { seniorId: 'S001', date: DEMO_DATE, vitals: { diastolic: 125 } } });
  const urgent = (await app.call('alerts')).data.alerts.find((alert) => alert.id === id);
  assert.equal(urgent.urgent, true);
  assert.equal(urgent.status, 'open');
});

test('cooldown suppresses nonurgent repeated daily alerts while high signals bypass it', async () => {
  const app = fixture({ admin: true });
  const past = new Date(Date.now() - 2 * 3600000).toISOString();
  for (const seniorId of ['S001', 'S002']) app.rows.push({ id: `OLD-${seniorId}`, kind: 'alert_state', seniorId, alertId: `A-${seniorId}-2026-10-26`, status: 'resolved', createdAt: past });
  let result = await app.call('alerts');
  assert.deepEqual(result.data.alerts.map((alert) => alert.seniorId), ['S002']);
  assert.equal(result.data.suppressed.length, 1);
  assert.equal(result.data.suppressed[0].seniorId, 'S001');
  await app.call('alerts/policy', { method: 'POST', body: { minimumScore: 30, cooldownHours: 1 } });
  result = await app.call('alerts');
  assert.ok(result.data.alerts.some((alert) => alert.seniorId === 'S001'));
});

test('family alerts contain only linked high-priority notices and no clinical raw details', async () => {
  const app = fixture({ role: 'family' });
  const { data } = await app.call('alerts');
  assert.equal(data.alerts.length, 1);
  assert.equal(data.alerts[0].seniorId, 'S002');
  assert.equal(data.alerts[0].score, undefined);
  assert.equal(data.alerts[0].fingerprint, undefined);
  assert.ok(!JSON.stringify(data).includes('Private clinical raw note'));
  assert.equal(data.policy, undefined);
});

test('operations and linked roles cannot mutate alerts, and policy requires owner admin', async () => {
  for (const role of ['operations', 'family', 'senior']) {
    const app = fixture({ role });
    assert.equal((await app.call(`alerts/A-S002-${DEMO_DATE}`, { method: 'PATCH', body: { status: 'acknowledged' } })).status, 403);
    assert.equal((await app.call('alerts/policy', { method: 'POST', body: { minimumScore: 30, cooldownHours: 24 } })).status, 403);
  }
  const coordinator = fixture();
  assert.equal((await coordinator.call('alerts/policy', { method: 'POST', body: { minimumScore: 30, cooldownHours: 24 } })).status, 403);
});

test('future observations do not create urgent alerts or change summaries', async () => {
  const app = fixture();
  const before = (await app.call('summaries/S003')).data.summary.text;
  app.rows.push({ id: 'FUTURE', kind: 'signal', seniorId: 'S003', mood: 'help', record: { seniorId: 'S003', date: '2026-10-28', vitals: { spo2: 80 }, note: 'Fell today. Chest pain.' } });
  const { data } = await app.call('alerts');
  assert.ok(!data.alerts.some((alert) => alert.seniorId === 'S003'));
  assert.equal((await app.call('summaries/S003')).data.summary.text, before);
});

test('feedback/model is staff-scoped and honestly reports insufficient supervision', async () => {
  const app = fixture({ scope: ['S001'] });
  app.rows.push({ kind: 'feedback', seniorId: 'S002', useful: true, score: 80 });
  app.rows.push({ kind: 'feedback', seniorId: 'S001', useful: false, score: 35 });
  const response = await app.call('feedback/model');
  assert.equal(response.status, 200);
  assert.equal(response.data.model.trained, false);
  assert.equal(response.data.model.examples, 1);
  assert.equal(response.data.model.predictUsefulAlert, undefined);
  assert.equal((await fixture({ role: 'family' }).call('feedback/model')).status, 403);
});

test('unsupported routes return null, and invalid state/policy input cannot persist', async () => {
  const app = fixture({ admin: true });
  assert.equal(await app.call('not-handled'), null);
  assert.equal((await app.call(`alerts/A-S001-${DEMO_DATE}`, { method: 'PATCH', body: { status: 'hidden' } })).status, 400);
  assert.equal((await app.call('alerts/policy', { method: 'POST', body: { minimumScore: 80, cooldownHours: 0 } })).status, 400);
  assert.equal((await app.call(`alerts/A-S001-${DEMO_DATE}`, { method: 'PATCH', body: { status: 'snoozed', snoozeHours: 25 } })).status, 400);
  assert.equal(app.rows.length, 0);
});

test('runtime as-of date drives alert identity, evidence cutoff and summary period',async()=>{
  const app=fixture();
  app.rows.push({id:'TODAY-HELP',kind:'signal',seniorId:'S003',mood:'help',record:{seniorId:'S003',date:'2026-10-28',note:'I need help today.'}});
  assert.ok(!(await app.call('alerts')).data.alerts.some(alert=>alert.seniorId==='S003'));
  const result=await app.call('alerts',{asOfDate:'2026-10-28'});
  const urgent=result.data.alerts.find(alert=>alert.seniorId==='S003');
  assert.equal(urgent.id,'A-S003-2026-10-28');assert.equal(urgent.urgency,'immediate');assert.equal(urgent.urgencyRank,0);
  const summary=await app.call('summaries/S003',{asOfDate:'2026-10-28'});
  assert.equal(summary.data.summary.period.to,'2026-10-28');
  assert.equal((await app.call('alerts',{asOfDate:'2026-02-31'})).status,400);
});

test('unknown support produces an unsuppressed check-in alert instead of treating null as zero',async()=>{
  const app=fixture({admin:true});
  Object.assign(app.profiles[2],{score:null,level:'unknown',urgency:'unknown',urgencyRank:2,action:'Collect missing observations.'});
  await app.call('alerts/policy',{method:'POST',body:{minimumScore:60,cooldownHours:72}});
  app.rows.push({kind:'alert_state',seniorId:'S003',alertId:'A-S003-2026-10-26',status:'resolved',createdAt:new Date().toISOString()});
  const result=await app.call('alerts');const unknown=result.data.alerts.find(alert=>alert.seniorId==='S003');
  assert.equal(unknown.level,'unknown');assert.equal(unknown.score,null);assert.equal(unknown.urgency,'unknown');
  assert.match(unknown.title,/missing observations/);assert.equal(result.data.counts.unknown,1);
  assert.ok(!result.data.suppressed.some(alert=>alert.seniorId==='S003'));
});

test('first-seen time uses the persisted event and first acknowledgement survives later resolution',async()=>{
  const app=fixture();const id=`A-S001-${DEMO_DATE}`;
  const firstSeenAt=new Date(Date.now()-600000).toISOString();
  app.rows.push({id:'SEEN',kind:'alert_seen',seniorId:'S001',alertId:id,firstSeenAt,createdAt:firstSeenAt});
  let alert=(await app.call('alerts')).data.alerts.find(item=>item.id===id);
  assert.equal(alert.firstSeenAt,firstSeenAt);assert.equal(alert.createdAt,firstSeenAt);assert.equal(alert.firstSeenPersisted,true);assert.equal(alert.firstAcknowledgedAt,null);
  const changes=[];
  const acknowledged=await app.call(`alerts/${id}`,{method:'PATCH',body:{status:'acknowledged'},onMutation:change=>changes.push(change)});
  const firstAcknowledgedAt=acknowledged.data.alert.firstAcknowledgedAt;
  assert.ok(Number.isFinite(Date.parse(firstAcknowledgedAt)));assert.ok(Date.parse(firstAcknowledgedAt)>=Date.parse(firstSeenAt));
  await app.call(`alerts/${id}`,{method:'PATCH',body:{status:'resolved',outcome:'Called and agreed next care visit.'}});
  alert=(await app.call('alerts')).data.alerts.find(item=>item.id===id);
  assert.equal(alert.firstAcknowledgedAt,firstAcknowledgedAt);assert.equal(alert.firstSeenAt,firstSeenAt);
  assert.equal(changes.length,1);assert.equal(changes[0].kind,'alert_state');
});

test('Supabase family and senior summaries read only their approved recipient inbox, never cached drafts',async()=>{
 for(const role of ['family','senior']){
  const app=fixture({role});let reads=0;
  const approved={summary:{text:'A reviewed update from the care team.',method:'Reviewed report',period:{from:'2026-10-22',to:'2026-10-28',days:7},privateRawNote:'must not leak',requiresHumanReview:true},approvedAt:'2026-10-28T10:00:00Z'};
  const options={asOfDate:'2026-10-28',db:{backend:'supabase',familySummary:async(id,date)=>{assert.equal(id,'S002');assert.equal(date,'2026-10-28');reads++;return approved;}},cohort:null,rows:[],cachedSummary(){throw Error('An unapproved cached draft must never be read');}};
  const result=await app.call('summaries/S002',options);
  assert.equal(result.status,200);assert.equal(result.data.status,'approved');assert.equal(result.data.summary.text,approved.summary.text);assert.equal(result.data.summary.requiresHumanReview,false);assert.equal(result.data.summary.privateRawNote,undefined);assert.equal(result.data.approvedAt,approved.approvedAt);assert.equal(reads,1);
  assert.equal((await app.call('summaries/S001',options)).status,403);assert.equal(reads,1);
  if(role==='family'){app.profiles[1].familyConsent=false;assert.equal((await app.call('summaries/S002',options)).status,403);assert.equal(reads,1);}
 }
});

test('a missing approved summary returns a usable pending state without reading a draft or raw history',async()=>{
 const app=fixture({role:'family'}),options={asOfDate:'2026-10-28',db:{backend:'supabase',familySummary:async()=>({summary:null})},cohort:null,rows:[],cachedSummary:{text:'UNAPPROVED DRAFT',period:{to:'2026-10-28'}}};
 const result=await app.call('summaries/S002',options);assert.equal(result.status,200);assert.equal(result.data.status,'pending_review');assert.equal(result.data.summary,null);assert.equal(result.data.canRequest,true);assert.deepEqual(result.data.period,{from:'2026-10-22',to:'2026-10-28',days:7});assert.doesNotMatch(JSON.stringify(result.data),/UNAPPROVED|Private/);
 const noCapability=await app.call('summaries/S002',{...options,db:{backend:'supabase'}});assert.equal(noCapability.status,200);assert.equal(noCapability.data.status,'pending_review');
});

test('family summary supports each linked senior and retains prior approved updates while the current period is pending',async()=>{
 const app=fixture({role:'family',scope:['S001','S002']}),reads=[];
 const options={asOfDate:'2026-10-28',db:{backend:'supabase',familySummary:async id=>{reads.push(id);return {summary:{text:'Reviewed update for '+id,method:'Reviewed report',period:{from:'2026-10-15',to:'2026-10-21',days:7}}};}},cohort:null,rows:[]};
 for(const id of ['S001','S002']){const result=await app.call('summaries/'+id,options);assert.equal(result.status,200);assert.equal(result.data.summary.text,'Reviewed update for '+id);assert.equal(result.data.currentPeriodPending,true);}
 assert.deepEqual(reads,['S001','S002']);assert.equal((await app.call('summaries/S003',options)).status,403);assert.equal(reads.length,2);
});

test('a future approved-summary period cannot leak into an earlier workspace date',async()=>{
 const app=fixture({role:'family'});const result=await app.call('summaries/S002',{asOfDate:'2026-10-28',db:{backend:'supabase',familySummary:async()=>({summary:{text:'Future update',period:{to:'2026-10-29'}}})},cohort:null,rows:[]});assert.equal(result.status,200);assert.equal(result.data.status,'pending_review');assert.equal(result.data.summary,null);
});

test('roster candidates are filtered before scoring and cache still uses authoritative getSenior',async()=>{
  const app=fixture({scope:['S001']});let lookups=0;
  const result=await app.call('alerts',{cohort:null,cachedSeniors:[{id:'S001'},{id:'S001'},{id:'S002'}],engine:{rankSeniors(){throw new Error('Full roster scoring forbidden');}},getSenior(id){lookups++;assert.equal(id,'S001');return app.profiles[0];}});
  assert.equal(result.status,200);assert.equal(lookups,1);assert.equal(result.data.alerts.length,1);
  const denied=await app.call('alerts',{cohort:null,cachedSeniors:[{id:'S001'}],getSenior(){throw Object.assign(new Error('Scope revoked'),{status:403});}});
  assert.equal(denied.status,403);
});

test('Supabase family alerts preserve safe resolved state without raw events or source details',async()=>{
  const app=fixture({role:'family'});
  const safe={id:'S002',name:'Synthetic family member',familyConsent:true,careState:{status:'resolved'},careAlert:{id:`A-S002-${DEMO_DATE}`,seniorId:'S002',name:'Synthetic family member',date:DEMO_DATE,level:'high',status:'resolved',createdAt:'2026-10-27T06:00:00Z',updatedAt:'2026-10-27T06:12:00Z',score:99,reasons:[{detail:'Private raw finding'}],fingerprint:'private'}};
  const options={db:{backend:'supabase'},rows:[],cohort:null,engine:{rankSeniors(){throw new Error('Raw scoring forbidden');}},getSenior:()=>safe};
  const result=await app.call('alerts',options);
  assert.equal(result.status,200);assert.equal(result.data.alerts.length,1);assert.equal(result.data.alerts[0].status,'resolved');assert.equal(result.data.counts.resolved,1);assert.equal(result.data.counts.open,0);assert.equal(result.data.alerts[0].updatedAt,safe.careAlert.updatedAt);
  assert.equal(result.data.alerts[0].score,undefined);assert.equal(result.data.alerts[0].fingerprint,undefined);assert.ok(!JSON.stringify(result.data).includes('Private raw finding'));assert.equal(result.data.policy,undefined);
  safe.familyConsent=false;assert.equal((await app.call('alerts',options)).status,403);
});

test('Supabase routine seniors and missing safe cache never receive an invented alert',async()=>{
  const app=fixture({role:'senior'});
  const safe={id:'S002',name:'Synthetic senior',familyConsent:true,careState:{status:'unreviewed'}};
  const options={db:{backend:'supabase'},rows:[],cohort:null,engine:{rankSeniors(){throw new Error('Raw scoring forbidden');}},getSenior:()=>safe};
  let result=await app.call('alerts',options);assert.equal(result.status,200);assert.deepEqual(result.data.alerts,[]);assert.equal(result.data.counts.total,0);
  safe.careAlert={id:`A-S002-${DEMO_DATE}`,seniorId:'S002',date:DEMO_DATE,status:'acknowledged',helpRequested:true,createdAt:'2026-10-27T08:00:00Z',score:99,reasons:[{detail:'Private finding'}]};
  result=await app.call('alerts',options);assert.equal(result.data.alerts.length,1);assert.match(result.data.alerts[0].title,/request for a call/);assert.equal(result.data.counts.acknowledged,1);assert.equal(result.data.alerts[0].score,undefined);assert.equal(result.data.alerts[0].reasons,undefined);
  safe.careAlert.date='2026-10-26';assert.deepEqual((await app.call('alerts',options)).data.alerts,[]);
  safe.careAlert.date=DEMO_DATE;safe.careAlert.seniorId='S001';assert.deepEqual((await app.call('alerts',options)).data.alerts,[]);
});

test('Supabase family alerts require an explicit current high-priority safe flag',async()=>{
  const app=fixture({role:'family'});const safe={id:'S002',name:'Synthetic',score:80,level:'high',familyConsent:true};
  const options={db:{backend:'supabase'},rows:[],getSenior:()=>safe};
  assert.deepEqual((await app.call('alerts',options)).data.alerts,[]);
  safe.careAlert={id:`A-S002-${DEMO_DATE}`,seniorId:'S002',date:DEMO_DATE,status:'open',level:'unknown'};
  assert.deepEqual((await app.call('alerts',options)).data.alerts,[]);
});
