import {analyzeSms} from './sms-understanding.mjs';
/** The provider supplies speech-to-text; local assertion-aware NLP interprets
 * consented speech. Missing/low confidence never becomes a health answer. */
export function interpretCallSpeech(text,confidence,questionId){
 if(typeof text!=='string'||!text.trim()||text.length>600||typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<.75||confidence>1)return null;
 const value=text.normalize('NFKC').trim().toLowerCase().replace(/[.!।?]+$/u,'').trim();
 if(/^(?:stop|end call|band karo|बंद करो|बंद करें)$/u.test(value))return {digit:'9'};
 if(/^(?:human|call me|callback|insaan se baat|किसी से बात करनी है|मुझे फोन करें)$/u.test(value))return {digit:'0'};
 const analysis=analyzeSms(text),cues=analysis?.cues||[];
 if(analysis?.intent==='help')return {help:true,cues,urgency:analysis.urgency};
 let digit=null;
 if(questionId==='wellbeing'){
  if(/^(?:(?:(?:i am|i'm|feeling|all)\s+)?(?:fine|okay|ok|well|as usual)|(?:main |mai )?(?:theek|thik|achha|badhiya)(?:\s+(?:hoon|hun|hu))?|(?:मैं\s*)?(?:ठीक|अच्छा|अच्छी|बढ़िया)(?:\s*(?:हूँ|हूं))?)$/u.test(value)&&!cues.length)digit='1';
  else if(analysis?.intent==='callback'||/^(?:different|not well|unwell|ठीक नहीं|तबीयत खराब)$/u.test(value))digit='2';
 }else if(questionId==='medicines'){
  if(cues.some(c=>c.cue==='missed_medication'))digit='2';
  else if(cues.some(c=>['medicine_question','medicine_supply'].includes(c.cue)))digit='3';
  else if(/^(?:(?:i have |i |already )?(?:taken|took)(?: my| the)? (?:medicine|medicines|medication|tablets)|(?:dawai|dawa) (?:le li|li hai)|दवा ले ली|दवाई ले ली)$/u.test(value))digit='1';
 }else if(questionId==='daily_routine'){
  if(cues.some(c=>c.cue==='low_appetite'))digit='2';
  else if(cues.some(c=>c.cue==='poor_sleep'))digit='3';
  else if(/^(?:as usual|usual|normal|सब सामान्य है|सब ठीक है)$/u.test(value))digit='1';
 }else if(questionId==='support'){
  if(/^(?:usual|routine|normal|रोज की तरह|सामान्य)$/u.test(value))digit='1';
  else if(analysis?.intent==='callback'||/^(?:today|call today|आज फोन करें|आज)$/u.test(value))digit='2';
 }
 return digit||cues.length||analysis?.intent==='callback'?{digit,cues,callback:analysis?.intent==='callback',urgency:analysis?.urgency}:null;
}
