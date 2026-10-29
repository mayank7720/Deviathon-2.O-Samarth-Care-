import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCues,classifyTriage,NOTE_CUE_MODEL} from '../lib/triage.mjs';

const cues=text=>extractCues(text).map(c=>c.cue).sort();

test('intrinsic negative language describes present wellbeing concerns without swallowing other symptoms',()=>{
  for(const [text,expected] of [
    ['I have no appetite.',['low_appetite']],
    ['I am not eating well.',['low_appetite']],
    ["She isn't eating.",['low_appetite']],
    ['I am not sleeping.',['poor_sleep']],
    ['I cannot sleep.',['poor_sleep']],
    ['Yaad nahi aa raha kya kiya.',['confusion']],
    ['मुझे याद नहीं आ रहा।',['confusion']],
    ['Bhookh nahin lagti. Neend nahi aati.',['low_appetite','poor_sleep']],
    ['No appetite and chest pain now.',['chest_pain','low_appetite']],
    ['I am not sleeping and feel tired.',['fatigue','poor_sleep']],
  ])assert.deepEqual(cues(text),expected.sort(),text);
});

test('external denials and coordinated negative lists suppress cues including contractions',()=>{
  for(const text of [
    'No pain or confusion. No fall.',
    'Denies poor sleep or low appetite.',
    'Dard nahi hai. Neend kam nahi aayi.',
    'दर्द नहीं है। नींद कम नहीं आई।',
    "I haven't missed any medicines.",
    'I have not missed any doses.',
    "She isn't confused or breathless.",
    'Chest pain is not present.',
    'No appetite changes.',
    'No appetite loss.',
    'Not eating less than usual.',
    'I am not sleeping poorly.',
  ])assert.deepEqual(cues(text),[],text);
});

test('negation ends at a new assertion and all repeated mentions are inspected',()=>{
  assert.deepEqual(cues('No pain and I feel tired.'),['fatigue']);
  assert.deepEqual(cues('No pain and feels lonely.'),['loneliness']);
  assert.deepEqual(cues('No pain earlier, pain now.'),['pain']);
  assert.deepEqual(cues('No breathlessness earlier; breathless now.'),['breathlessness']);
  assert.deepEqual(cues('I feel not only tired but weak.'),['fatigue']);
  assert.deepEqual(cues('No change in pain.'),['pain']);
  assert.deepEqual(cues('Without relief from pain.'),['pain']);
});

test('education, questions, remote history and explicitly resolved symptoms are not current assertions',()=>{
  for(const text of [
    'If chest pain develops, call the team.',
    'Watch for confusion.',
    'Discussed fall prevention.',
    'She might fall without a handrail.',
    'Do you have chest pain?',
    'Any pain?',
    'क्या सीने में दर्द है?',
    'History of a fall last year, fully recovered.',
    'Pain months ago.',
    'पिछले साल गिर गई थी।',
    'Chest pain has resolved.',
    'Pain is gone.',
    'Blood pressure fell after rest.',
    'I fall asleep at ten.',
  ])assert.deepEqual(cues(text),[],text);
});

test('recent falls, uncertain actual events and recurrence stay visible for human verification',()=>{
  for(const text of ['Had a fall yesterday.','She may have fallen last night.','A history of falls, fell again today.']){
    assert.ok(cues(text).includes('fall'),text);
    assert.equal(classifyTriage({score:0,level:'low'},{note:text}).urgency,'immediate',text);
  }
});

test('explicit other people remain excluded through following pronouns while senior reports are kept',()=>{
  for(const text of ['My daughter fell. She is in pain.','मेरी बेटी गिर गई।','His friend has chest pain. He is breathless.'])assert.deepEqual(cues(text),[],text);
  assert.deepEqual(cues('My daughter said I fell yesterday.'),['fall']);
  assert.deepEqual(cues('My mother has chest pain and she is breathless.'),['breathlessness','chest_pain']);
});

test('additional Hindi and Hinglish urgent expressions retain bounded source evidence',()=>{
  for(const [text,cue] of [['Saans phool rahi hai.','breathlessness'],['सांस फूल रही है।','breathlessness'],['छाती में दर्द है।','chest_pain'],['Chest me dard hai.','chest_pain']]){
    const actual=extractCues(text).find(c=>c.cue===cue);
    assert.ok(actual,text);assert.equal(actual.model,NOTE_CUE_MODEL.id);assert.equal(actual.assertion,'present-or-recent');assert.ok(actual.evidence.length<=180);
    assert.equal(classifyTriage({score:0,level:'low'},{note:text}).urgency,'immediate');
  }
});

test('evaluated browser motion cannot be reclassified by the legacy impact shortcut',()=>{
  const record={sensor:{source:'browser-motion',detectionEvaluated:true,impactG:3,postureChange:true,fallDetected:false}};
  assert.equal(classifyTriage({score:0,level:'low'},record).urgency,'routine');
  assert.equal(classifyTriage({score:0,level:'low'},{sensor:{...record.sensor,fallDetected:true}}).urgency,'immediate');
  assert.equal(classifyTriage({score:0,level:'low'},{sensor:{impactG:3,postureChange:true}}).urgency,'immediate');
});

test('remote history and historical denial cannot hide a coexisting acute symptom',()=>{
  for(const text of [
    'History of falls. Chest pain now.',
    'History of falls with chest pain.',
    'Chest pain with a history of falls.',
    'No prior falls and chest pain today.',
    'No fall in the past and chest pain now.',
    'Pain last year and chest pain now.',
    'My daughter called because I have chest pain.',
    'My daughter called. I am breathless.',
    'मेरी बेटी ने बताया कि मुझे सीने में दर्द है।',
    'The fall happened last year but today I have chest pain.',
  ]){
    assert.ok(extractCues(text).some(cue=>['chest_pain','breathlessness'].includes(cue.cue)),text);
    assert.equal(classifyTriage({score:0,level:'low'},{note:text}).urgency,'immediate',text);
  }
  assert.deepEqual(cues('No appetite and I feel tired.'),['fatigue','low_appetite']);
});

test('retrospective uncertainty and Hindi recent falls request verification rather than being treated as future advice',()=>{
  for(const text of ['कल गिर गई थी।','आज गिर गया।','She may have fallen today.','Not sure if she has fallen today.','If she fell yesterday we need to know.']){
    assert.ok(cues(text).includes('fall'),text);
    assert.equal(classifyTriage({score:0,level:'low'},{note:text}).urgency,'immediate',text);
  }
  for(const text of ['If a fall occurs, call the team.','She might fall without a handrail.','History of a fall last year.'])assert.deepEqual(cues(text),[],text);
});

test('additional natural urgent wording keeps paired denials and other-person reports distinct',()=>{
  for(const [text,cue] of [
    ['I feel pressure in my chest now.','chest_pain'],['सीने में जकड़न हो रही है।','chest_pain'],
    ['I am having trouble catching my breath.','breathlessness'],['सांस नहीं ले पा रही हूँ।','breathlessness'],
    ['कल मैं गिरा था।','fall'],['कल मैं गिरी थी।','fall'],
  ]){
    assert.ok(cues(text).includes(cue),text);
    assert.equal(classifyTriage({score:0,level:'low'},{note:text}).urgency,'immediate',text);
  }
  for(const text of ['No pressure in my chest.','My daughter has pressure in her chest.','No trouble catching my breath.','मेरी बेटी कल गिरी थी।','If you feel pressure in your chest, call for help.'])assert.deepEqual(cues(text),[],text);
});
test('memory, eating and missed-dose paraphrases are assertion aware',()=>{
  for(const [text,cue] of [
    ['Father could not remember where he was.','confusion'],['मुझे समझ नहीं आ रहा मैं कहाँ हूँ।','confusion'],
    ["I haven't been eating for two days.",'low_appetite'],['भूख लगती नहीं है।','low_appetite'],
    ['Missed a scheduled medicine dose.','missed_medication'],['दवा की एक या अधिक खुराक नहीं ली।','missed_medication'],['Dawai ki dose nahi li.','missed_medication'],
  ])assert.ok(cues(text).includes(cue),text);
  for(const text of ['Na dard hai na uljhan.','भूख नहीं कम हुई है।','I did not miss a scheduled medicine dose.','My daughter could not remember where she was.'])assert.deepEqual(cues(text),[],text);
});
