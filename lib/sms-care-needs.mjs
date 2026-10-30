import {extractAdditionalCues} from './triage.mjs';
export const SMS_NEEDS_VERSION='sms-care-needs-v1';
// Describes a reported need, never a condition or a dosage recommendation.
const needs=[
 {cue:'medicine_supply',label:'Medicine supply or refill help',severity:2,patterns:[/\b(?:ran|run|running)\s+out\s+of\s+(?:my\s+)?(?:medicine|medication|tablets?|pills?)/iu,/\b(?:medicine|medication|tablets?|pills?)\s+(?:has\s+)?(?:finished|over|unavailable)/iu,/\b(?:dawai|dawa|dava)\s+(?:khatam|khatm)/iu,/(?:दवा|दवाई|दवाइयाँ)\s*(?:खत्म|ख़त्म|समाप्त)/u]},
 {cue:'extra_dose',label:'An extra medicine dose was reported',severity:4,patterns:[/\b(?:took|taken|swallowed)\s+(?:(?:my|the|a|an)\s+)?(?:extra|double|two)\s+(?:dose|tablet|pill)/iu,/\b(?:dawai|dawa|goli)\s+(?:do\s+baar|do\s+bar|double)\s+(?:li|le\s+li)/iu,/(?:दवा|दवाई|गोली)\s*(?:दो\s*बार|दोबारा|दुबारा)\s*(?:ली|ले\s*ली)/u]},
 {cue:'medicine_question',label:'Help understanding the medicine schedule',severity:2,patterns:[/\b(?:do not|don't|cannot|can't)\s+(?:understand|read)\s+(?:my\s+|the\s+)?(?:medicine|medication|prescription)/iu,/\b(?:which|when)\s+(?:medicine|tablet)\s+(?:to\s+)?take\b/iu,/\b(?:dawai|dawa)\s+(?:kab|kaise)\s+(?:leni|len[ae])/iu,/(?:दवा|दवाई)\s*(?:कब|कैसे)\s*(?:लेनी|लूँ|लूं)/u]},
 {cue:'dizziness',label:'Dizziness or light-headedness mentioned',severity:2,patterns:[/\b(?:dizzy|dizziness|lightheaded|light-headed)\b/iu,/\bchakkar\s+(?:aa|a|aate|aa\s+rahe)/iu,/चक्कर\s*(?:आ|आते)/u]},
 {cue:'fainting',label:'Fainting or loss of consciousness reported',severity:4,patterns:[/\b(?:I|senior|mother|father)\s+(?:have\s+|had\s+)?(?:fainted|passed\s+out|blacked\s+out)/iu,/\b(?:behosh|behoosh)\s+(?:ho\s+gay[ai]|hua|hui)/iu,/बेहोश\s*(?:हो\s*गए|हो\s*गया|हो\s*गई|हुआ|हुई)/u]},
 {cue:'mobility_help',label:'Difficulty standing or walking reported',severity:3,patterns:[/\b(?:cannot|can't|unable\s+to)\s+(?:stand\s+up|walk|get\s+up|move\s+from\s+(?:the\s+)?bed)/iu,/\b(?:chal|uth)\s+nahi\s+pa\s+rah[ai]/iu,/(?:चल|उठ)\s*(?:नहीं|नही)\s*पा\s*रह[ाी]/u]},
 {cue:'speech_change',label:'A new speech difficulty was reported',severity:4,patterns:[/\b(?:my\s+)?speech\s+(?:is\s+)?(?:slurred|unclear)/iu,/\b(?:bolne|bolna)\s+(?:mein|me)\s+(?:dikkat|takleef)/iu,/बोलने\s*(?:में)?\s*(?:दिक्कत|तकलीफ)/u]},
 {cue:'vomiting',label:'Vomiting mentioned',severity:2,patterns:[/\b(?:vomiting|vomited|throwing\s+up|threw\s+up)\b/iu,/\bulti\s+(?:ho|hui|aa)/iu,/उल्टी\s*(?:हो|हुई|आ)/u]},
 {cue:'loose_stools',label:'Loose stools mentioned',severity:2,patterns:[/\b(?:diarrh[oe]+a|loose\s+(?:stools|motions))\b/iu,/\b(?:dast|pet\s+kharab)\b/iu,/दस्त|पेट\s*खराब/u]},
 {cue:'fluid_intake',label:'Difficulty drinking or keeping fluids down',severity:2,patterns:[/\b(?:cannot|can't|unable\s+to)\s+(?:drink|keep\s+(?:water|fluids)\s+down)/iu,/\b(?:pani|paani)\s+nahi\s+pi\s+pa/iu,/पानी\s*(?:नहीं|नही)\s*पी\s*पा/u]},
 {cue:'fever_report',label:'Feeling feverish reported',severity:2,patterns:[/\b(?:I\s+(?:have|feel)|feeling)\s+(?:a\s+)?(?:fever|feverish)/iu,/\b(?:mujhe\s+)?bukhar\s+(?:hai|aa)/iu,/बुखार\s*(?:है|आ)/u]},
 {cue:'swelling',label:'New swelling mentioned',severity:2,patterns:[/\b(?:my\s+)?(?:feet|legs|ankles|hands)\s+(?:are|is|look)\s+(?:swollen|swelling)/iu,/\b(?:pair|paon)\s+(?:mein\s+|me\s+)?(?:sujan|soojan)/iu,/(?:पैर|पांव|पाँव)\s*(?:में)?\s*सूजन/u]},
 {cue:'urinary_discomfort',label:'Urinary discomfort mentioned',severity:2,patterns:[/\b(?:pain|burning)\s+(?:when|while)\s+(?:passing\s+urine|urinating)/iu,/\b(?:peshab|peshaab)\s+(?:mein|me)\s+(?:jalan|dard)/iu,/पेशाब\s*(?:में)?\s*(?:जलन|दर्द)/u]},
 {cue:'care_access',label:'Help arranging a care visit or transport',severity:1,patterns:[/\b(?:need|want)\s+(?:help\s+(?:with|getting)\s+)?(?:a\s+)?(?:doctor\s+visit|appointment|transport\s+to\s+(?:the\s+)?hospital)/iu,/\bdoctor\s+(?:ke\s+paas\s+)?(?:jana|dikhana)\s+hai/iu,/डॉक्टर\s*(?:के\s*पास)?\s*(?:जाना|दिखाना)\s*है/u]},
];
export const SMS_NEEDS_CATALOG=Object.freeze(needs.map(({cue,label,severity})=>({cue,label,severity})));
export function detectSmsCareNeeds(message){return extractAdditionalCues(message,needs,SMS_NEEDS_VERSION);}
