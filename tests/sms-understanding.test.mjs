import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSms,SMS_ANALYSIS_VERSION} from '../lib/sms-understanding.mjs';
import {phoneCommand} from '../lib/phone-intake.mjs';

test('English, Hindi and Hinglish requests accept case, greetings, punctuation and common spelling variations',()=>{
 const help=['help','helpme','hlp','halp','helpp','heeelp','SOS','s.o.s','s o s','H E L P','urgent','emergency','madad','madat','maddad','sahayta','bachao','bachaao','मदद','सहायता','बचाओ','please help','pls help me','plz madad karo','I need help','we need your help','could you help me','can someone help','mujhe madad chahiye','hume madad chahiye','मुझे मदद चाहिए','कृपया मदद करें','I am alone, please help'];
 const callback=['call','cal','callme','callback','call back','phone','कॉल','फोन','please call me','pls call','could you call me','can you ring me','ring me please','mujhe call karo','mujhe phone karna','hume call kijiye','wapas call kare','मुझे कॉल करो','कृपया फोन करें','coordinator se baat karni hai','could you call back','I need a call','मुझे बात करनी है'];
 for(const [expected,phrases]of [['help',help],['callback',callback]])for(const text of phrases)for(const variant of [text,text.toUpperCase(),`  ${text}  `,`${text}!`])assert.equal(phoneCommand(variant)?.kind,expected,variant);
});

test('natural wellbeing messages use the shared assertion-aware cue model with source evidence',()=>{
 for(const[text,cue,urgency]of [
  ['I fell yesterday.','fall','immediate'],['आज गिर गया।','fall','immediate'],['gir gaya aaj','fall','immediate'],
  ['I have chest pain now.','chest_pain','immediate'],['सीने में दर्द है।','chest_pain','immediate'],['seene mein dard hai','chest_pain','immediate'],
  ["I can't breathe.",'breathlessness','immediate'],['saans lene mein dikkat hai','breathlessness','immediate'],['सांस लेने में दिक्कत है।','breathlessness','immediate'],
  ['I am confused.','confusion','immediate'],['I have no appetite.','low_appetite','today'],['bhookh nahi lagti','low_appetite','today'],
  ['I forgot my medicines.','missed_medication','today'],['दवाई लेना भूल गया।','missed_medication','today'],['I feel lonely.','loneliness','today'],['I cannot sleep.','poor_sleep','today'],
 ]){const result=analyzeSms(text);assert.notEqual(result.intent,'none',text);assert.equal(result.urgency,urgency,text);assert.ok(result.cues.some(x=>x.cue===cue&&x.evidence),text);assert.equal(result.version,SMS_ANALYSIS_VERSION);assert.equal(result.externalServiceUsed,false);assert.equal(result.needsHumanReview,true);assert.ok(!('diagnosis' in result));assert.ok(!('confidence' in result));}
});

test('denials, quotes, old events, other people and everyday phone words do not become care requests',()=>{
 for(const text of [
  'I do not need help',"don't call me",'please do not call','cancel callback','no help needed','help nahi chahiye','मुझे मदद नहीं चाहिए','मुझे कॉल मत करो','call mat karo',
  'help is available on Monday','the word HELP means support','example: HELP','If I fall, please call me','अगर गिर जाऊं तो मदद करना',
  'No pain or confusion. No fall.','I have not fallen','dard nahi hai','दर्द नहीं है।','My daughter fell. She is in pain.',
  'History of a fall last year.','Chest pain has resolved.','Do you have chest pain?','Fall sale ends today','I fell in love','I like fall',
  'my phone battery is low','phone battery is low','please phone battery replacement','call log updated','your call is important to us',
  'HELPFUL advice','OTP 123456','1','I am fine thanks','please help yourself to food',
 ])assert.equal(phoneCommand(text),null,text);
});

test('a denial does not hide a separate explicit request or new concerning assertion',()=>{
 for(const text of ['No help needed earlier, but please help now.',"Don't call about the appointment, but I have chest pain now.",'No pain earlier; pain now.','मदद नहीं चाहिए। लेकिन सांस फूल रही है।'])assert.notEqual(analyzeSms(text).intent,'none',text);
 assert.equal(analyzeSms('please call me; I fell today').intent,'help');
 assert.equal(analyzeSms('please call me; I fell today').urgency,'immediate');
 for(const text of ['I do not feel well, please help','I need help, do not call about the bill','Please help me stop feeling lonely'])assert.equal(analyzeSms(text).intent,'help',text);
});

test('simple unwellness reports request confirmation without inventing a specific condition',()=>{
 for(const text of ['I am unwell','I am not feeling well','Not feeling well','meri tabiyat kharab hai','मेरी तबीयत खराब है']){const value=analyzeSms(text);assert.equal(value.intent,'callback',text);assert.equal(value.urgency,'today');assert.deepEqual(value.cues,[]);}
 for(const text of ['I am not unwell','I am not feeling unwell','If I am unwell, I will call','example: meri tabiyat kharab hai'])assert.equal(analyzeSms(text).intent,'none',text);
});
