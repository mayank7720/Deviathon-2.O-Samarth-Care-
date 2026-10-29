import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTriage, compareTriage, extractCues, URGENCY_RANK } from '../lib/triage.mjs';

test('shared triage recognises severe readings, fall, help and submitted sensor evidence',()=>{
  for(const record of [
    {vitals:{glucose:68}},{vitals:{spo2:88}},{vitals:{diastolic:125}},
    {note:'Had a fall today.'},{note:'My mother is breathless.'},
    {mood:'help'},{note:'मदद चाहिए।'},{note:'I need help now.'},
    {sensor:{fallDetected:true}},{sensor:{impactG:3,postureChange:true}},
  ])assert.equal(classifyTriage({score:0,level:'low'},record).urgency,'immediate',JSON.stringify(record));
});
test('unknown support has explicit ordering without hiding immediate evidence',()=>{
  const unknown=classifyTriage({score:null,level:'unknown'});
  assert.equal(unknown.urgencyRank,URGENCY_RANK.unknown);
  assert.equal(classifyTriage({score:null,level:'unknown'},{vitals:{glucose:68}}).urgency,'immediate');
  const entries=[{id:'R',score:0,level:'low'},{id:'U',score:null,level:'unknown'},{id:'T',score:100,level:'high'},{id:'I',score:60,level:'high',...classifyTriage({},{note:'Chest pain now.'})}].sort(compareTriage);
  assert.deepEqual(entries.map(entry=>entry.id),['I','T','U','R']);
});
test('other-person symptoms and negated help do not create an immediate flag',()=>{
  assert.equal(classifyTriage({score:0,level:'low'},{note:'My daughter fell yesterday but I am fine.'}).urgency,'routine');
  assert.equal(classifyTriage({score:0,level:'low'},{note:'I do not need help.'}).urgency,'routine');
  assert.ok(!extractCues('मेरी बेटी गिर गई। मैं ठीक हूँ।').some(cue=>cue.cue==='fall'));
});
