import {extractCues,NOTE_CUE_MODEL} from './triage.mjs';
import {classifySmsIntent} from './sms-intent.mjs';
import {detectSmsCareNeeds,SMS_NEEDS_VERSION} from './sms-care-needs.mjs';

export const SMS_ANALYSIS_VERSION='sms-understanding-v2';
const HELP='help|helpme|hlp|halp|helpp|heeelp|hepl|hlep|sos|s o s|emergency|urgent|madad|madat|maddad|sahayata|sahayta|bachao|bachaao|मदद|सहायता|बचाओ';
const CALL='call|cal|callme|callback|call back|phone|ring|contact|कॉल|काल|फोन|फ़ोन';
const POLITE='(?:(?:hello|hi|namaste|namaskar|please|pls|plz|kindly|ji|कृपया|प्लीज|नमस्ते)\\s+){0,4}';
const start=source=>new RegExp('^'+POLITE+'(?:'+source+')(?=\\s|$)','iu');
const helpStart=start(HELP),callStart=start(CALL);
const helpRequest=new RegExp('(?:^|\\s)(?:(?:i|we)\\s+(?:really\\s+)?(?:need|want|require)\\s+(?:some\\s+|your\\s+|urgent\\s+)?|(?:can|could|will|would)\\s+(?:you|someone|somebody)\\s+(?:please\\s+)?|(?:mujhe|hame|hume|hamein|humko|mereko|मुझे|हमें|हमको)\\s+(?:(?:aapki|apki|आपकी)\\s+)?)(?:'+HELP+')(?=\\s|$)','iu');
const callRequest=new RegExp('(?:^|\\s)(?:(?:can|could|will|would)\\s+you\\s+(?:please\\s+)?(?:'+CALL+')\\s+(?:me|us)|(?:mujhe|hame|hume|humko|मुझे|हमें)\\s+(?:please\\s+)?(?:'+CALL+')|(?:please|pls|plz|kindly|wapas|वापस)\\s+(?:'+CALL+')|(?:care\\s+)?coordinator\\s+se\\s+baat\\s+karni|कोऑर्डिनेटर\\s+से\\s+बात\\s+करनी)(?=\\s|$)','iu');
const negativeIntent=terms=>new RegExp('(?:^|\\s)(?:(?:don\'t|dont|do not|does not|did not|never|cancel|stop|no|mat|मत)\\s+(?:(?:need|want|any|more|a|the|this|to|for|calling)\\s+){0,4}(?:'+terms+')|(?:'+terms+')\\s+(?:is\\s+)?(?:not\\s+(?:needed|required)|nahi[n]?\\s+(?:chahiye|chaiye|karna|karo|kare)|नहीं\\s*(?:चाहिए|करना|करें|करो)|mat|मत))(?=\\s|$)','iu');
const deniedHelp=negativeIntent(HELP),deniedCall=negativeIntent(CALL);
const informational=/^(?:if|agar|यदि|अगर|for|how to|what is|example|sample|quote|the word|word|message says|your|aapka|आपका)\s|^(?:help|मदद)\s+(?:is|was|available)|^(?:call|phone)\s+(?:log|history|balance|battery|number|screen|charger|plan|service|settings|recording)/iu;

/** Assertion rules plus a trained synthetic-text intent classifier. No LLM,
 * remote inference, diagnostic probability or clinical accuracy is implied. */
export function analyzeSms(value){
 if(typeof value!=='string'||value.length>1600||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value))return null;
 const message=value.normalize('NFKC').trim();if(!message)return null;
 const normalized=message.toLowerCase().replace(/[’‘]/gu,"'")
  .replace(/\bh[\s.\-]+e[\s.\-]+l[\s.\-]+p\b/giu,'help')
  .replace(/\bs[.\-]+o[.\-]+s\b/giu,'sos');
 let help=false,callback=false,unwell=false;
 for(const clause of normalized.split(/[.!?।;\n]+|\b(?:but|however|lekin|magar)\b|लेकिन|मगर/iu)){
  const text=clause.replace(/[^\p{L}\p{M}\p{N}'\s]/gu,' ').replace(/\s+/gu,' ').trim();
  if(!text||informational.test(text))continue;
  if(/(?:^|\s)help\s+yourself(?=\s|$)/iu.test(text))continue;
  const unprefixed=text.replace(new RegExp('^'+POLITE,'iu'),'');
  if(informational.test(unprefixed))continue;
  if(/^(?:(?:i am|i'm|im|i feel|i am feeling)\s+(?:very\s+)?unwell|(?:i am |i'm |im )?not feeling well|(?:meri |mujhe |मेरी |मुझे )?(?:tabiyat|tabiyet|तबीयत|तबियत)\s+(?:bahut |बहुत )?(?:kharab|खराब))(?=\s|$)/iu.test(unprefixed))unwell=true;
  if(!deniedHelp.test(text)&&(helpStart.test(text)||helpRequest.test(text)||/(?:^|\s)(?:please|pls|plz)\s+(?:help|madad|मदद)(?=\s|$)/iu.test(text)))help=true;
  if(!deniedCall.test(text)&&(callStart.test(text)&&!informational.test(unprefixed)&&(!/^(?:phone|contact|ring|फोन|फ़ोन)\s/iu.test(unprefixed)||/^(?:phone|contact|ring|फोन|फ़ोन)\s+(?:me|us|karo|kar|kare|kijiye|करो|करें|कीजिए)(?=\s|$)/iu.test(unprefixed))||callRequest.test(text)||/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:call|call back|callback)|i\s+(?:need|want)\s+(?:a\s+)?(?:call|callback)|(?:mujhe|मुझे)\s+baat\s+karni|मुझे\s+बात\s+करनी)(?=\s|$)/iu.test(unprefixed)))callback=true;
 }
 // Existing note analysis already handles denials, old events, questions and
 // explicit other-person subjects. A wellbeing concern also accepts prose SMS.
 const cues=[...extractCues(message),...detectSmsCareNeeds(message)].filter(cue=>cue.cue!=='fall'||!/\b(?:fall|fell|fallen)\s+(?:sale|season|in\s+love|collection)\b|\bi\s+like\s+fall\b/iu.test(cue.evidence));
 const promptCue=cues.some(cue=>['fall','chest_pain','breathlessness','confusion','extra_dose','fainting','speech_change','mobility_help'].includes(cue.cue));
 const classifier=classifySmsIntent(message),ruleIntent=help||promptCue?'help':callback||unwell||cues.length?'callback':'none';
 // A model-only suggestion never establishes clinical severity. Failed release
 // gates leave ML in shadow mode; explicit commands/cues keep working.
 const intent=ruleIntent!=='none'?ruleIntent:classifier.accepted?'callback':'none';
 const urgency=promptCue?'immediate':help?'prompt':intent==='callback'?'today':'none';
 const reasons=[...(help?['Support was explicitly requested.']:[]),...(callback?['A callback was explicitly requested.']:[]),...(unwell?['The sender reports feeling unwell.']:[]),...cues.map(cue=>cue.label),...(ruleIntent==='none'&&classifier.accepted?['The local text classifier suggested a care request. Confirm its meaning during a callback.']:[])];
 const language=/[\u0900-\u097F]/u.test(message)?'hi':/\b(?:mujhe|hume|hame|madad|madat|karo|kijiye|chahiye|saans|dard|bhookh|nahi|gir|akela)\b/iu.test(message)?'hinglish':'en';
 return {version:SMS_ANALYSIS_VERSION,method:'local-rules-and-intent-ml',cueModel:NOTE_CUE_MODEL.id,needsModel:SMS_NEEDS_VERSION,intent,urgency,language,cues,reasons,classifier,decisionSource:ruleIntent!=='none'?'assertion-rules':classifier.accepted?'trained-intent-supplement':'no-request',
  needsHumanReview:intent!=='none',externalServiceUsed:false,
  nextStep:urgency==='immediate'?'Contact the sender promptly, verify who needs help and arrange human assessment.':intent!=='none'?'Call the sender to confirm the request and agree the next step.':'No care request identified. This does not clear any existing concern.'};
}
