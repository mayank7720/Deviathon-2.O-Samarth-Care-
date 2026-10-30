/** Bounded call dialogue. Generic prompts, structured answers, no diagnosis or LLM. */
import {buildIvrPrompt} from './communications.mjs';
import {initialRecipientCall,recipientCallPrompt,recipientCallSummary,advanceRecipientCall} from './call-recipient.mjs';
import {interpretCallSpeech} from './call-speech.mjs';
const words={en:{consent:'Hello, this is the SwasthSync automated wellbeing check-in. If you are the senior and agree to save your answers, press 1. If someone else answered, press 2. To decline, press 9. This is not an emergency service.',declined:'Thank you. We will end this automated check-in.',wrong_person:'Thank you. No wellbeing answers will be saved for the senior. Please ask the care team to arrange another time.',no_response:'We could not understand your answer. The care team will see that the check-in is incomplete. Please contact your coordinator directly if you need help.',help:'Your request for help has been saved for the care team. If you are in immediate danger, call 112 or ask someone nearby for help. This service does not dispatch emergency assistance.',human:'Your request for a human callback has been saved. Please call your coordinator directly if you need immediate contact.',complete:'Thank you. Your answers are saved for your care team to review. Please contact your coordinator if anything changes.',retry:'Sorry, please press 1, 2 or 3. Press 0 to request a human callback, or 9 to stop.',controls:' You can press 0 for a human callback or 9 to stop.',speech:' You may also say one, two or three. Please do not share names, numbers or medical details.'},hi:{consent:'नमस्ते। यह स्वास्थ्य जानकारी लेने के लिए स्वास्थसिंक का स्वचालित कॉल है। अगर आप वरिष्ठ सदस्य हैं और जवाब सुरक्षित रखने की अनुमति देते हैं तो 1 दबाएँ। किसी और ने फोन उठाया है तो 2 दबाएँ। मना करने के लिए 9 दबाएँ। यह आपातकालीन सेवा नहीं है।',declined:'धन्यवाद। यह स्वचालित कॉल समाप्त हो रहा है।',wrong_person:'धन्यवाद। वरिष्ठ सदस्य के स्वास्थ्य के जवाब दर्ज नहीं होंगे। कृपया देखभाल टीम से बात करने का समय तय करें।',no_response:'आपका जवाब समझ में नहीं आया। देखभाल टीम को अधूरी बातचीत दिखाई जाएगी। मदद चाहिए तो सीधे कोऑर्डिनेटर को फोन करें।',help:'मदद का अनुरोध देखभाल टीम के लिए दर्ज हो गया है। तुरंत खतरा हो तो 112 पर फोन करें या पास के व्यक्ति से सहायता माँगें। यह सेवा आपातकालीन सहायता नहीं भेजती।',human:'देखभाल टीम से फोन पर बात करने का अनुरोध दर्ज हो गया है। तुरंत बात करनी हो तो सीधे कोऑर्डिनेटर को फोन करें।',complete:'धन्यवाद। आपके जवाब देखभाल टीम की समीक्षा के लिए दर्ज हैं। कोई बदलाव हो तो कोऑर्डिनेटर से संपर्क करें।',retry:'माफ कीजिए। कृपया 1, 2 या 3 दबाएँ। किसी व्यक्ति से बात करने के लिए 0 और बंद करने के लिए 9 दबाएँ।',controls:' किसी व्यक्ति से बात करने के लिए 0 और बंद करने के लिए 9 दबाएँ।',speech:' आप एक, दो या तीन भी बोल सकते हैं। कृपया नाम, नंबर या बीमारी की जानकारी न बोलें।'}};
const questionIds=['wellbeing','medicines','daily_routine','support'];
/** @param {string} language
 * @param {{spokenChoices?:boolean,recipientRole?:string,notice?:{reference?:string,cues?:string[],kind?:string,urgent?:boolean,checkin?:object}|null}} options */
export function initialCallBot(language='hi',{spokenChoices=false,recipientRole='senior',notice=null}={}){
 if(!['en','hi'].includes(language))throw Error('Choose Hindi or English.');
 if(recipientRole!=='senior')return initialRecipientCall(language,recipientRole,{spokenChoices,notice});
 return {version:2,language,spokenChoices:spokenChoices===true,...(notice?.kind==='help'?{callPurpose:'help-callback'}:{}),cursor:0,step:0,answers:{},consent:'pending',complete:false,retries:0,turns:0,completionReason:null,helpRequested:false,callRequested:false,summary:null};
}
export function callBotPrompt(state){
 if(state.purpose==='care-notice')return recipientCallPrompt(state);
 const copy=words[state.language];
 if(state.complete)return {text:copy[state.completionReason]||copy.complete,complete:true,input:'none'};
 if(state.consent==='pending')return {text:copy.consent+(state.spokenChoices?(state.language==='hi'?' अनुमति देने के बाद आपके बोले हुए जवाब कॉल सेवा द्वारा समझे जाएँगे। आप बटन दबाकर भी जवाब दे सकते हैं।':' After agreement, your spoken answers will be processed by the call provider. You can also use the keypad.') :''),complete:false,input:'dtmf'};
 const prompt=state.callPurpose==='help-callback'?{prompt:state.language==='hi'?'आपके मदद वाले संदेश के बाद फोन किया है। बताइए क्या परेशानी है। हालत सामान्य है तो 1, तबीयत बदली है तो 2, तुरंत मदद चाहिए तो 3 दबाएँ।':'We are calling about your help text. Briefly say what you need. Press 1 if you feel as usual, 2 if something changed, or 3 if you need prompt help.'}:buildIvrPrompt({language:state.language,step:state.step,answers:state.answers});
 const speech=state.language==='hi'?' आप छोटा जवाब बोल भी सकते हैं या एक, दो, तीन कह सकते हैं। अपना नाम या फोन नंबर न बोलें।':' You may give a short spoken answer or say one, two or three. Please do not say your name or phone number.';
 return {text:(state.retries?copy.retry+' ':'')+prompt.prompt+copy.controls+(state.spokenChoices?speech:''),complete:false,input:state.spokenChoices?'dtmf speech':'dtmf'};
}
export function spokenChoice(text,confidence){
 if(typeof text!=='string'||text.length>50||typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0.75||confidence>1)return null;
 const value=text.normalize('NFKC').trim().toLowerCase().replace(/[.!।?]+$/u,'').trim();
 return ({one:'1',two:'2',three:'3','1':'1','2':'2','3':'3','एक':'1','दो':'2','तीन':'3',ek:'1',do:'2',teen:'3'})[value]||null;
}
export function callBotSummary(state){
 if(state.purpose==='care-notice')return recipientCallSummary(state);
 const a=state.answers,parts=[];
 if(a.wellbeing)parts.push(({usual:'Reports feeling as usual.',changed:'Reports feeling different from usual.',help:'Requests help.'})[a.wellbeing]);
 if(a.medicines)parts.push(({taken:'Reports taking medicines according to the agreed plan.',missed:'Reports a missed medicine dose; verify which dose and why.',review:'Requests a medicine-plan review.'})[a.medicines]);
 if(a.daily_routine)parts.push(({usual:'Reports usual food and sleep.',less_food:'Reports eating less.',less_sleep:'Reports sleeping less.'})[a.daily_routine]);
 if(a.support)parts.push(({routine:'Requests the usual check-in.',today:'Requests a callback today.',prompt:'Requests prompt support.'})[a.support]);
 if(state.completionReason==='human')parts.push('Requests a human callback.');
 const reportedCues=state.reportedCues||[];
 if(reportedCues.length)parts.push('Consented voice report mentioned: '+reportedCues.map(c=>c.label).join('; ')+'. Verify these self-reported concerns during human review.');
 const expected=state.callPurpose==='help-callback'?['wellbeing']:questionIds,unknown=expected.filter(k=>!a[k]);
 return {version:'call-bot-summary-v1',method:'structured-answer-summary',llmUsed:false,
  text:parts.length?parts.join(' '):'No wellbeing answers were obtained.',answeredQuestions:Object.keys(a).length,totalQuestions:expected.length,unansweredQuestions:unknown,reportedCueCount:reportedCues.length,
  consentGranted:state.consent==='granted',helpRequested:state.helpRequested===true,
  priority:state.helpRequested?'prompt':state.callRequested||a.medicines==='missed'||a.daily_routine==='less_food'||a.daily_routine==='less_sleep'||state.completionReason==='no_response'?'today':'routine',
  nextStep:state.helpRequested?'Contact promptly to verify the request. SMS and call notices do not dispatch emergency services.':state.callRequested?'Arrange a human callback and verify the reported answers.':unknown.length?'Arrange contact if needed; unanswered questions remain unknown.':'Review these self-reported answers alongside the senior’s own history.',
  limitations:'Structured self-report, not a diagnosis. A completed carrier call does not prove identity or a completed human follow-up.'};
}
export function finishInterruptedCall(state){
 if(state.version!==2||state.complete)return state;
 const next={...state,complete:true,completionReason:state.consent==='granted'?'disconnected':'not_started'};
 next.summary=callBotSummary(next);return next;
}
export function advanceCallBot(state,input={}){
 if(state.version!==2||state.complete)return state;
 if(state.purpose==='care-notice')return advanceRecipientCall(state,input,spokenChoice);
 const next={...state,answers:{...state.answers},cursor:state.cursor+1,turns:state.turns+1};
 let digit=typeof input.digit==='string'&&/^[0-9]$/.test(input.digit)?input.digit:state.consent==='granted'&&state.spokenChoices?spokenChoice(input.speech,input.confidence):null;
 const finish=reason=>{next.complete=true;next.completionReason=reason;next.summary=callBotSummary(next);return next;};
 if(!digit&&state.consent==='granted'&&state.spokenChoices){
  const interpreted=interpretCallSpeech(input.speech,input.confidence,questionIds[state.step]);
  if(interpreted){
   digit=interpreted.digit;
   if(interpreted.cues?.length)next.reportedCues=[...new Map([...(state.reportedCues||[]),...interpreted.cues].map(c=>[c.cue,{cue:c.cue,label:c.label,evidence:c.evidence}])).values()].slice(0,24);
   if(interpreted.help){next.helpRequested=true;next.callRequested=true;if(state.step===0){next.answers.wellbeing='help';next.step=1;}return finish('help');}
   if(interpreted.callback)next.callRequested=true;
   if(state.callPurpose==='help-callback'&&interpreted.cues?.length&&!digit)return finish('complete');
   if(!digit&&(interpreted.cues?.length||interpreted.callback))return finish('human');
  }
 }
 if(state.consent==='pending'){
  if(digit==='1'){next.consent='granted';next.retries=0;return next;}
  if(digit==='2'){next.consent='wrong_person';return finish('wrong_person');}
  if(digit==='9'){next.consent='declined';return finish('declined');}
 }else{
  if(digit==='9')return finish('declined');
  if(digit==='0'){next.callRequested=true;return finish('human');}
  if(['1','2','3'].includes(digit)){
   const prompt=buildIvrPrompt({language:state.language,step:state.step,answers:state.answers});
   next.answers[prompt.questionId]=prompt.options.find(o=>o.digit===digit).value;
   next.step++;next.retries=0;
   next.helpRequested=next.answers.wellbeing==='help'||next.answers.support==='prompt';
   next.callRequested=next.callRequested||next.helpRequested||next.answers.support==='today'||next.answers.medicines==='review';
   if(next.helpRequested)return finish('help');
   if(next.step===4)return finish('complete');
   if(state.callPurpose==='help-callback')return finish('complete');
   return next;
  }
 }
 next.retries++;
 if(next.retries>=2||next.turns>=8)return finish('no_response');
 return next;
}
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function callBotTwiml(state,actionUrl){
 const url=new URL(actionUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error('Use a protected HTTPS callback.');
 const prompt=callBotPrompt(state),language=state.language==='hi'?'hi-IN':'en-IN',voice=state.language==='hi'?'Google.hi-IN-Standard-C':'Google.en-IN-Standard-E';
 const say=`<Say voice="${voice}" language="${language}">${xml(prompt.text)}</Say>`;
 if(prompt.complete)return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
 return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="${prompt.input}" numDigits="1" timeout="8" speechTimeout="auto" language="${language}" actionOnEmptyResult="true" action="${xml(url.href)}" method="POST">${say}</Gather></Response>`;
}
