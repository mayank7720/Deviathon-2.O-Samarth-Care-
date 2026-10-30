/** Role-bound care notices. These responses never become senior health answers. */
const roles=new Set(['family','coordinator','operations']);
const labels={en:{family:'registered family contact',coordinator:'assigned care coordinator',operations:'operations manager'},hi:{family:'परिवार के पंजीकृत सदस्य',coordinator:'जिम्मेदार देखभाल कोऑर्डिनेटर',operations:'ऑपरेशन्स प्रबंधक'}};
const issues={
 chest_pain:['chest discomfort','सीने में दर्द'],breathlessness:['breathing difficulty','सांस लेने में दिक्कत'],fall:['a fall','गिरने की घटना'],confusion:['confusion','उलझन'],
 missed_medication:['missed medicine','दवा छूटने की बात'],extra_dose:['an extra medicine dose','दवा की अतिरिक्त खुराक'],medicine_supply:['medicine refill help','दवा फिर से मंगाने में मदद'],medicine_question:['a medicine schedule question','दवा के समय के बारे में सवाल'],
 low_appetite:['low appetite','भूख कम लगना'],poor_sleep:['poor sleep','नींद कम आना'],loneliness:['loneliness','अकेलापन'],pain:['pain or discomfort','दर्द'],fatigue:['weakness','कमजोरी'],
 dizziness:['dizziness','चक्कर'],fainting:['fainting','बेहोश होने की बात'],mobility_help:['difficulty standing or walking','उठने या चलने में दिक्कत'],speech_change:['speech difficulty','बोलने में दिक्कत'],
 vomiting:['vomiting','उल्टी'],loose_stools:['loose stools','दस्त'],fluid_intake:['difficulty drinking fluids','पानी पीने में दिक्कत'],fever_report:['feeling feverish','बुखार जैसा लगना'],swelling:['swelling','सूजन'],urinary_discomfort:['urinary discomfort','पेशाब में तकलीफ'],care_access:['visit or transport help','मुलाकात या आने जाने में मदद'],
};
/** @param {string} language @param {string} recipientRole
 * @param {{spokenChoices?:boolean,notice?:{reference?:string,cues?:string[],kind?:string,urgent?:boolean,checkin?:object}|null}} options */
export function initialRecipientCall(language,recipientRole,{spokenChoices=false,notice=null}={}){
 if(!['hi','en'].includes(language)||!roles.has(recipientRole))throw Error('Choose a supported call recipient and language.');
 const reference=/^S\d{3,6}$/u.test(notice?.reference||'')?notice.reference:null;
 const cues=[...new Set(Array.isArray(notice?.cues)?notice.cues:[])].filter(cue=>Object.hasOwn(issues,cue)).slice(0,2);
 const checkin=notice?.checkin&&typeof notice.checkin==='object'?safeCheckin(notice.checkin):null;
 return {version:2,recipientRole,purpose:'care-notice',language,spokenChoices:spokenChoices===true,notice:{reference,cues,kind:['help','callback'].includes(notice?.kind)?notice.kind:'care_update',urgent:notice?.urgent===true,...(checkin?{checkin}:{})},cursor:0,step:0,answers:{},consent:'pending',complete:false,retries:0,turns:0,completionReason:null,helpRequested:false,callRequested:false,summary:null};
}
function safeCheckin(value){
 const allowed={wellbeing:['usual','changed','help'],medicines:['taken','missed','review'],daily_routine:['usual','less_food','less_sleep'],support:['routine','today','prompt']},answers={};
 for(const [key,options]of Object.entries(allowed))if(options.includes(value.answers?.[key]))answers[key]=value.answers[key];
 return {completionReason:['complete','help','human','declined','wrong_person','no_response','disconnected','not_started'].includes(value.completionReason)?value.completionReason:'not_started',consent:value.consent==='granted'?'granted':'not_obtained',answers,
  cues:[...new Set((Array.isArray(value.reportedCues)?value.reportedCues:[]).map(c=>c?.cue).filter(c=>Object.hasOwn(issues,c)))].slice(0,4)};
}
function checkinBriefing(value,hi){
 if(!value)return '';
 const answers=value.answers||{},details=[];
 if(value.consent!=='granted')return hi?'वरिष्ठ सदस्य से स्वास्थ्य के जवाब नहीं मिले। पहचान और समस्या की पुष्टि के लिए सीधे संपर्क करें। ':'No senior wellbeing answers were obtained. Contact them directly to confirm identity and the concern. ';
 const copy={wellbeing:{usual:['feeling as usual','सामान्य महसूस करना'],changed:['a change in wellbeing','तबीयत में बदलाव'],help:['needing help','मदद की जरूरत']},medicines:{taken:['taking medicines as agreed','तय योजना के अनुसार दवा लेना'],missed:['a missed medicine dose','दवा की खुराक छूटना'],review:['a medicine-plan question','दवा की योजना पर सवाल']},daily_routine:{usual:['usual food and sleep','भोजन और नींद सामान्य'],less_food:['eating less','भोजन कम लेना'],less_sleep:['sleeping less','नींद कम आना']},support:{routine:['routine contact','नियमित संपर्क'],today:['a callback today','आज फोन पर बात'],prompt:['prompt support','शीघ्र मदद']}};
 for(const [key,answer]of Object.entries(answers))if(copy[key]?.[answer])details.push(copy[key][answer][hi?1:0]);
 for(const cue of value.cues||[])if(issues[cue])details.push(issues[cue][hi?1:0]);
 const reported=details.length?(hi?'वरिष्ठ सदस्य ने बताया: '+[...new Set(details)].join('। ')+'। ':'The senior reported: '+[...new Set(details)].join('; ')+'. '):(hi?'कोई स्पष्ट स्वास्थ्य जवाब नहीं मिला। ':'No clear wellbeing answer was obtained. ');
 return reported+(!['complete','help','human'].includes(value.completionReason)?(hi?'बातचीत अधूरी रही। बाकी जानकारी अज्ञात है। ':'The conversation was incomplete. Other information remains unknown. '):'');
}
export function recipientCallPrompt(state){
 const hi=state.language==='hi',staff=state.recipientRole!=='family';
 if(state.complete){const text=hi?(state.completionReason==='complete'?'धन्यवाद। आपका जवाब सुरक्षित दर्ज हो गया है। संबंधित देखभाल अनुरोध की समीक्षा अलग से करनी होगी।':'धन्यवाद। देखभाल टीम को इस कॉल का परिणाम दिखाई देगा।'):(state.completionReason==='complete'?'Thank you. Your response is saved. The care request still requires a separate review.':'Thank you. The care team will see this call outcome.');return {text,complete:true,input:'none'};}
 if(state.consent==='pending')return {text:(hi?`नमस्ते। यह स्वास्थसिंक की देखभाल सूचना है। अगर आप ${labels.hi[state.recipientRole]} हैं और सूचना सुनने व जवाब दर्ज करने की अनुमति देते हैं, तो 1 दबाएँ। किसी और ने फोन उठाया है तो 2 और मना करने के लिए 9 दबाएँ।`:`Hello. This is a SwasthSync care update for the ${labels.en[state.recipientRole]}. If this is you and you agree to hear the update and save your response, press 1. If someone else answered, press 2. To decline, press 9.`)+(state.spokenChoices?(hi?' अनुमति के बाद बोले हुए जवाब कॉल सेवा द्वारा समझे जाएँगे।':' After agreement, spoken answers will be processed by the call provider.') :''),complete:false,input:'dtmf'};
 const n=state.notice||{},terms=(n.cues||[]).filter(c=>issues[c]).map(c=>issues[c][hi?1:0]);
 const reference=n.reference?(hi?`वरिष्ठ संदर्भ ${n.reference}। `:`Senior reference ${n.reference}. `):'';
 const reason=(terms.length?(hi?`बताई गई परेशानी: ${terms.join(' और ')}। `:`Reported concern: ${terms.join(' and ')}. `):n.kind==='care_update'?(hi?'आपकी देखभाल टीम की सूचना है। सुरक्षित केयर इनबॉक्स देखें। ':'Your care team has an update. Review the secure care inbox. '):(hi?'सहायता या फोन पर बात करने का अनुरोध है। कारण की पुष्टि करें। ':'Help or a callback was requested. Confirm the reason. '))+checkinBriefing(n.checkin,hi);
 const prompt=hi?(staff?'देखभाल सूची की समीक्षा कर सकते हैं तो 1, अतिरिक्त मदद चाहिए तो 2, अभी उपलब्ध नहीं हैं तो 3 दबाएँ।':'उनकी खबर ले सकते हैं तो 1, देखभाल टीम से फोन चाहिए तो 2, अभी मदद नहीं कर सकते तो 3 दबाएँ।'):(staff?'Press 1 if you can review the care queue, 2 to request backup, or 3 if unavailable.':'Press 1 if you can check on them, 2 for a care-team callback, or 3 if unable to help now.');
 return {text:(state.retries?(hi?'जवाब समझ में नहीं आया। ':'We did not understand. '):'')+reference+(n.urgent?(hi?'कृपया शीघ्र ध्यान दें। ':'Please review promptly. '):'')+reason+prompt+(state.spokenChoices?(hi?' आप एक, दो या तीन भी बोल सकते हैं।':' You may also say one, two or three.'):'')+(hi?' कॉल बंद करने के लिए 9 दबाएँ।':' Press 9 to stop.'),complete:false,input:state.spokenChoices?'dtmf speech':'dtmf'};
}
export function recipientCallSummary(state){
 const answer=state.answers.noticeResponse,role=state.recipientRole;
 const text=answer==='acknowledged'?`The ${role} contact acknowledged the care notice.`:answer==='callback'?`The ${role} contact requested ${role==='family'?'a care-team callback':'backup'}.`:answer==='unavailable'?`The ${role} contact reported being unavailable.`:'No care-notice acknowledgement was obtained.';
 return {version:'recipient-call-summary-v1',method:'structured-recipient-response',llmUsed:false,recipientRole:role,text,answeredQuestions:answer?1:0,unansweredQuestions:answer?[]:['noticeResponse'],consentGranted:state.consent==='granted',helpRequested:false,priority:state.callRequested?'today':'routine',nextStep:state.callRequested?'Arrange a care-team response; this does not complete the senior’s follow-up.':'Review the care request separately. Acknowledging a notice does not complete the follow-up.',limitations:'A recipient response is not a senior health observation or proof of completed care.'};
}
export function advanceRecipientCall(state,input={},spokenChoice){
 if(state.complete)return state;
 const next={...state,answers:{...state.answers},cursor:state.cursor+1,turns:state.turns+1};
 let digit=typeof input.digit==='string'&&/^[0-9]$/u.test(input.digit)?input.digit:null;
 if(!digit&&state.consent==='granted'&&state.spokenChoices){
  digit=spokenChoice(input.speech,input.confidence);
  if(!digit&&typeof input.speech==='string'&&typeof input.confidence==='number'&&Number.isFinite(input.confidence)&&input.confidence>=.75&&input.confidence<=1){
   const s=input.speech.normalize('NFKC').trim().toLowerCase().replace(/[.!।?]+$/u,'');
   if(/^(?:yes|okay|i will check|i will review|haan|हाँ|हां|ठीक है|मैं देख लूंगा)$/u.test(s))digit='1';
   else if(/^(?:call me|need backup|callback|mujhe call karo|फोन करें|मुझे फोन करें|मदद चाहिए)$/u.test(s))digit='2';
   else if(/^(?:unavailable|cannot help|not available|अभी उपलब्ध नहीं|अभी नहीं)$/u.test(s))digit='3';
  }
 }
 const end=reason=>{next.complete=true;next.completionReason=reason;next.summary=recipientCallSummary(next);return next;};
 if(state.consent==='pending'){
  if(digit==='1'){next.consent='granted';next.retries=0;return next;}
  if(digit==='2'){next.consent='wrong_person';return end('wrong_person');}
  if(digit==='9'){next.consent='declined';return end('declined');}
 }else{
  if(digit==='9')return end('declined');
  if(['1','2','3','0'].includes(digit)){next.answers.noticeResponse=digit==='1'?'acknowledged':digit==='3'?'unavailable':'callback';next.callRequested=digit!=='1';next.step=1;return end('complete');}
 }
 next.retries++;return next.retries>=2?end('no_response'):next;
}
