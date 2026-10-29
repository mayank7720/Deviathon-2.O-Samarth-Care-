/** Shared local note understanding and prioritisation. No diagnostic probabilities. */
export const URGENCY_RANK = Object.freeze({ immediate: 0, today: 1, unknown: 2, routine: 3 });

const LEXICON = [
  { cue: 'chest_pain', label: 'Chest discomfort mentioned', severity: 4, patterns: [/chest\s+(?:(?:is|feels?)\s+)?(?:pain|discomfort|tightness|tight|hurts?|hurting)/iu, /(?:सीने|छाती)\s*(?:में)?\s*दर्द/u, /(?:seene?|chest|chh?ati)\s*(?:mein|me)?\s*dard/iu] },
  { cue: 'breathlessness', label: 'Breathing difficulty mentioned', severity: 4, patterns: [/breathless(?:ness)?/iu, /short(?:ness)?\s+of\s+breath/iu, /(?:difficulty|trouble)\s+breathing/iu, /(?:cannot|can't)\s+(?:catch\s+(?:my\s+)?breath|breathe)/iu, /सां?स\s*(?:लेने\s*)?(?:में\s*)?(?:दिक्कत|तकलीफ)/u, /सां?स\s*फूल/u, /sa+a?ns\s*(?:(?:lene|mein|me)\s*)?(?:dikkat|takleef|phool|ful)/iu] },
  { cue: 'fall', label: 'A fall mentioned', severity: 4, patterns: [/\b(?:fall|fell|fallen|tumbled)\b/iu, /गिर\s*(?:गई|गया|गए|पड़ी|पड़ा)/u, /\b(?:gir\s+(?:gayi|gaya|gaye)|girne)\b/iu, /lost\s+(?:my\s+)?balance\s+and\s+(?:landed|hit)/iu] },
  { cue: 'confusion', label: 'Confusion or disorientation', severity: 3, intrinsicNegation: true, patterns: [/confus(?:ed|ion)/iu, /disorient(?:ed|ation)/iu, /उलझन|भ्रम/u, /\buljhan\b/iu, /yaad\s+nahi\s+(?:aa|a|aata|aati)/iu, /याद\s*नहीं\s*(?:आ|है)/u, /(?:cannot|can't)\s+remember\s+(?:where|which|what|who)/iu, /(?:not\s+sure|unsure)\s+where\s+(?:I|she|he)\s+(?:am|is)/iu] },
  { cue: 'low_appetite', label: 'Low appetite or eating less', severity: 2, intrinsicNegation: true, patterns: [/(?:low|poor|reduced|no)\s+appetite/iu, /(?:eating|ate|eaten)\s+(?:much\s+)?less/iu, /(?:not|isn't|is\s+not|has\s+not|hasn't)\s+eat(?:ing|en)?/iu, /भूख\s*(?:नहीं|नही|कम)/u, /(?:खाना|खाया)\s*कम/u, /khana\s+kam/iu, /bh[ou]+kh?\s+(?:nahi[n]?|kam)/iu, /off\s+(?:my|her|his|their)\s+food/iu] },
  { cue: 'poor_sleep', label: 'Poor or reduced sleep', severity: 2, intrinsicNegation: true, patterns: [/sleep(?:ing)?\s+(?:poorly|badly|less)/iu, /poor\s+sleep/iu, /(?:not|isn't|is\s+not|cannot|can't)\s+sleep(?:ing)?/iu, /slept\s+(?:much\s+)?less/iu, /kept\s+waking\s+up/iu, /नींद\s*(?:नहीं|नही|कम|खराब)/u, /n[ei]+nd\s+(?:nahi[n]?|kam|kharab)/iu] },
  { cue: 'missed_medication', label: 'Missed medicines mentioned', severity: 2, intrinsicNegation: true, patterns: [/missed\s+(?:\w+\s+)?(?:medicin\w*|medicatio\w*|dose\w*)/iu, /forgot\s+(?:\w+\s+){0,3}(?:medicin\w*|medicatio\w*|dose\w*|tablets?|pills?)/iu, /दवा(?:ई|इयाँ|इयां)?\s*(?:लेना\s*)?(?:भूल|नहीं|नही)/u, /dawa[iy]?\s*(?:lena\s*)?(?:bhool|nahi[n]?)/iu, /(?:tablets?|pills?|medicines?)\s+(?:(?:were|was|are)\s+)?(?:left\s+untaken|not\s+taken)/iu] },
  { cue: 'pain', label: 'Pain or discomfort', severity: 2, patterns: [/\bpain\b/iu, /\b(?:dard|discomfort|aching|hurts?)\b/iu, /दर्द/u] },
  { cue: 'loneliness', label: 'Loneliness or isolation', severity: 1, patterns: [/lonel(?:y|iness)/iu, /feel(?:ing)?\s+alone/iu, /अकेलापन|अकेला|अकेली/u, /\bakela\b/iu, /miss\s+having\s+company/iu] },
  { cue: 'fatigue', label: 'Tiredness or weakness', severity: 1, patterns: [/\b(?:tired|fatigue|weak|weakness|exhausted)\b/iu, /कमजोरी|थकान/u, /\b(?:thakaan|kamzori)\b/iu] },
];
const cueMemo = new Map();
const OTHER_SUBJECT = /\b(?:my|his|her|their)\s+(?:daughter|son|wife|husband|friend|neighbou?r|grandchild|granddaughter|grandson)\b|(?:मेरी|मेरा|मेरे)\s*(?:बेटी|बेटा|पत्नी|पति|दोस्त|पड़ोसी)/giu;
function mentionsOtherSubject(clause, matchIndex) {
  const before = clause.slice(0, matchIndex);
  // First/third-person care notes and family reports about mother/father remain
  // eligible. Explicit child/spouse/friend subjects are not the senior unless
  // the sentence subsequently switches back to the senior's own experience.
  let lastOther = null;
  for (const match of before.matchAll(OTHER_SUBJECT)) lastOther = match;
  if (!lastOther) return false;
  const since = before.slice(lastOther.index + lastOther[0].length);
  return !/\b(?:I|myself|the\s+senior|the\s+patient|mother|father|mum|mom|dad)\b|(?:मुझे|मैं|वरिष्ठ)/iu.test(since);
}

function noteClauses(text) {
  // Keep punctuation for question detection. Explicit subject changes start a
  // fresh assertion, while "no pain or confusion" shares its negation scope.
  const pieces = text.normalize('NFKC').replace(/[’‘]/gu,"'")
    .split(/(?<=[.!?।;\n])|\b(?:but|however|lekin|magar)\b|लेकिन|मगर|,|\b(?:and|or)\s+(?=(?:I|he|she|the\s+(?:senior|patient)|my\s+(?:mother|father))\b)|\band\s+(?=(?:has|have|is|are|feels?|feeling|reports?)\b)|और\s+(?=(?:मैं|मुझे|मां|माँ|पिता))/iu)
    .map(part=>part.trim()).filter(Boolean);
  let previousOther=false;
  return pieces.map(clause=>{
    const inheritedOther=previousOther&&/^(?:she|he|they|वह|वे)\b/iu.test(clause);
    previousOther=[...clause.matchAll(OTHER_SUBJECT)].length>0||inheritedOther;
    return {clause,inheritedOther};
  });
}

function assertionFor(entry,clause,match) {
  const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
  const nearBefore=before.slice(-80),nearAfter=after.slice(0,65);
  // Negation inside a lexical phrase ("no appetite", "not eating", "yaad
  // nahi") is part of the positive cue. Only text OUTSIDE that match can deny it.
  const englishNegation=/\b(?:no|not|without|denies|denied|never|neither|isn't|wasn't|aren't|weren't|doesn't|don't|didn't|hasn't|haven't|hadn't)\b(?:\s+[\p{L}'-]+){0,5}\s*$/iu;
  let externalNegationContext=nearBefore.replace(/\bno\s+appetite\b(?!\s+(?:loss|changes?|problems?|issues?))/giu,'reduced appetite').replace(/\bnot\s+(?:eating|sleeping)\b/giu,'difficulty');
  // A denial of a previous event must not negate a newly mentioned symptom:
  // "no prior falls and chest pain now". A plain negative list keeps its scope.
  if(/\b(?:prior|past|previous|history|historical)\b/iu.test(externalNegationContext))externalNegationContext=externalNegationContext.split(/\b(?:and|with)\b|और/iu).at(-1);
  const negatedBefore=englishNegation.test(externalNegationContext)||/(?:नहीं|नही|न|nahi[n]?|nahin|naheen|nai)\s*$/iu.test(nearBefore);
  const negatedAfter=/^\s*(?:(?:is|are|was|were|hai|hain|है|हैं)\s+)?(?:(?:nahi|nahin|naheen|nai|absent|denied)\b|नहीं|नही|न\s|(?:not\s+(?:present|reported|felt|there|occurring))\b)/iu.test(nearAfter);
  // "not only tired" is emphatic, not a denial; a full intrinsic phrase is
  // never exempt from an external denial such as "denies poor appetite".
  const modifierOnly=/\bnot\s+(?:only|just)\s*$|\b(?:no|without)\s+(?:change|improvement|relief|increase)\s+(?:in|from)\s*$|\bnot\s+sure\s+(?:if|whether)(?:\s+[\p{L}'-]+){0,3}\s*$/iu.test(nearBefore);
  const deniedReduction=(entry.cue==='low_appetite'&&/^(?:not|isn't|is\s+not)\s+eat/iu.test(match[0])&&/^\s+less\b/iu.test(nearAfter))||(entry.cue==='poor_sleep'&&/^(?:not|isn't|is\s+not)\s+sleep/iu.test(match[0])&&/^\s+(?:poorly|badly|less)\b/iu.test(nearAfter))||(entry.cue==='low_appetite'&&/^no\s+appetite$/iu.test(match[0])&&/^\s+(?:loss|changes?|problems?|issues?)\b/iu.test(nearAfter));
  if((negatedBefore&&!modifierOnly)||negatedAfter||deniedReduction)return 'negated';
  const hypothetical=/\b(?:if|watch\s+for|in\s+case\s+of|risk\s+of|prevent(?:ing|ion\s+of)?|avoid(?:ing)?)\b(?:\s+[\p{L}'-]+){0,8}\s*$/iu.test(nearBefore)||/(?:अगर|यदि|हो\s*तो)\s*$/u.test(nearBefore);
  const question=/\?\s*$/u.test(clause)&&/^\s*(?:(?:do|does|did|is|are|was|were|has|have|any|can|could|kya)\b|क्या)/iu.test(clause);
  const futureFall=entry.cue==='fall'&&(/\b(?:might|may|could|will|would)\s*$/iu.test(nearBefore)||/^\s+(?:risk|prevention|asleep|in\s+(?:blood\s+pressure|BP|temperature|weight))/iu.test(nearAfter)||/\b(?:blood\s+pressure|BP|temperature|weight|sugar)\s*$/iu.test(nearBefore));
  const uncertainRecentFall=entry.cue==='fall'&&/^(?:fell|fallen)$/iu.test(match[0])&&/\b(?:today|yesterday|last\s+night|earlier|already)\b|आज|कल|अभी/iu.test(clause);
  if((hypothetical&&!uncertainRecentFall)||question||futureFall)return 'hypothetical';
  // Remote history is distinct from an unresolved recent fall. Do not suppress
  // "fell yesterday" or a newly recurring symptom just because it is past tense.
  // History belongs to the mention around it, not every symptom in the same
  // sentence: "chest pain with a history of falls" still needs prompt review.
  const temporalBefore=before.split(/\b(?:and|with)\b|और/iu).at(-1),temporalAfter=after.split(/\b(?:and|with)\b|और/iu)[0];
  const temporalContext=temporalBefore+match[0]+temporalAfter;
  const remote=/\b(?:history\s+of|years?\s+ago|months?\s+ago|last\s+year|in\s+(?:19\d{2}|20[0-1]\d))\b/iu.test(temporalContext)||/(?:साल|वर्ष|महीने)\s*पहले|पिछले\s*साल|(?:saal|mahine)\s+pehle/iu.test(temporalContext);
  const current=/\b(?:now|today|currently|again|new|still|ongoing)\b|आज|अभी|फिर|aaj|abhi/iu.test(temporalContext);
  const resolved=/^\s*(?:(?:has|have|had|is|was|are|were)\s+)?(?:resolved|gone|settled|fully\s+recovered|no\s+longer\s+present)\b/iu.test(nearAfter)||/\b(?:previous|earlier|prior)\s*$/iu.test(nearBefore)&&/\b(?:resolved|gone|settled)\b/iu.test(nearAfter);
  if(remote&&!current||resolved&&entry.cue!=='fall')return 'historical-or-resolved';
  return 'present-or-recent';
}

/** Versioned, hand-authored multilingual assertion rules; not clinical NLP validation. */
export const NOTE_CUE_MODEL=Object.freeze({id:'bilingual-assertions-v2',method:'Hindi/English/Hinglish lexical cues with bounded assertion context',validation:'Hand-authored regression examples; not an independently labelled clinical corpus.'});
export function extractCues(text = '') {
  if (typeof text !== 'string' || !text.trim()) return [];
  if (cueMemo.has(text)) return cueMemo.get(text);
  const clauses = noteClauses(text);
  const found = [];
  for (const entry of LEXICON) {
    let evidence;
    for (const {clause,inheritedOther} of clauses) {
      for (const expression of entry.patterns) {
        // Inspect all occurrences so "no pain earlier, pain now" can retain a
        // later positive mention instead of stopping at the first negation.
        const allMatches = new RegExp(expression.source, expression.flags.includes('g') ? expression.flags : expression.flags + 'g');
        for (const match of clause.matchAll(allMatches)) {
          if (inheritedOther || mentionsOtherSubject(clause, match.index)) continue;
          if (assertionFor(entry,clause,match)!=='present-or-recent') continue;
          evidence = clause.trim().replace(/[.!?।;]+$/gu,'').trim().slice(0, 180);
          break;
        }
        if (evidence) break;
      }
      if (evidence) break;
    }
    if (evidence) found.push({ cue: entry.cue, label: entry.label, severity: entry.severity, evidence, subject: 'senior-or-care-subject', assertion:'present-or-recent', model:NOTE_CUE_MODEL.id, attribution: 'bounded rule; confirm with the reporter' });
  }
  const result = Object.freeze((found.some((cue) => cue.cue === 'chest_pain') ? found.filter((cue) => cue.cue !== 'pain') : found).map(Object.freeze));
  if (cueMemo.size >= 256) cueMemo.delete(cueMemo.keys().next().value);
  cueMemo.set(text, result);
  return result;
}

/** Authoritative urgency used by scores, analytics, routes and queues. */
export function classifyTriage(scored = {}, record = {}) {
  const records = Array.isArray(record) ? record : [record];
  const evidence = [];
  const cues = [...(scored.cues || [])];
  for (const item of records) {
    cues.push(...extractCues(item?.note));
    if (Array.isArray(item?.cues)) cues.push(...item.cues);
    const vitals = item?.vitals || {};
    if (Number.isFinite(vitals.spo2) && vitals.spo2 < 90) evidence.push({ id: 'oxygen-reading', detail: `Submitted oxygen reading ${vitals.spo2}%; verify promptly.` });
    if ((Number.isFinite(vitals.systolic) && vitals.systolic >= 180) || (Number.isFinite(vitals.diastolic) && vitals.diastolic >= 120)) evidence.push({ id: 'pressure-reading', detail: 'Submitted blood-pressure reading crosses the prompt-review rule.' });
    if (Number.isFinite(vitals.glucose) && (vitals.glucose < 70 || vitals.glucose >= 300)) evidence.push({ id: 'glucose-reading', detail: `Submitted glucose ${vitals.glucose} mg/dL; verify promptly.` });
    const evaluatedBrowserMotion=item?.sensor?.source==='browser-motion'&&item?.sensor?.detectionEvaluated===true;
    if (item?.sensor?.fallDetected === true || (!evaluatedBrowserMotion&&item?.sensor?.impactG >= 2.5 && item?.sensor?.postureChange === true)) evidence.push({ id: 'sensor-fall', detail: 'A submitted device flag needs human verification; no fall is confirmed.' });
    const helpNote = typeof item?.note === 'string' && /\b(?:I\s+need\s+help|please\s+help\s+me|please\s+call\s+me)\b|मदद\s*चाहिए/iu.test(item.note) && !/\b(?:do\s+not|don't|no\s+longer)\s+need\s+help\b/iu.test(item.note);
    if (item?.mood === 'help' || item?.helpRequested === true || item?.lifestyle?.mood === 'help' || helpNote) evidence.push({ id: 'help-request', detail: 'The senior requested help or a prompt call.' });
  }
  for (const cue of cues) if (['chest_pain', 'breathlessness', 'fall'].includes(cue.cue) && !evidence.some((item) => item.id === cue.cue)) evidence.push({ id: cue.cue, detail: cue.evidence || cue.label });
  const urgent = evidence.length > 0 || scored.immediateReview === true;
  const urgency = urgent ? 'immediate' : scored.level === 'high' || scored.level === 'medium' || (Number.isFinite(scored.score) && scored.score >= 30) ? 'today' : scored.level === 'unknown' || scored.score === null || scored.warmup === true ? 'unknown' : 'routine';
  return {
    urgency, urgencyRank: URGENCY_RANK[urgency], immediateReview: urgent,
    triageEvidence: evidence,
    triageAction: urgency === 'immediate' ? 'Contact the senior now. Verify the report and arrange urgent clinical assessment; use local emergency support if there is immediate distress.' : urgency === 'today' ? 'Arrange a care-team check-in today and agree the next step.' : urgency === 'unknown' ? 'Call to confirm wellbeing and collect the missing observations; current priority cannot be established from these records.' : 'Continue the agreed routine check-ins and review any new changes.',
  };
}

export function compareTriage(a, b) {
  const urgencyA = Number.isFinite(a.urgencyRank) ? a.urgencyRank : classifyTriage(a, a.latest).urgencyRank;
  const urgencyB = Number.isFinite(b.urgencyRank) ? b.urgencyRank : classifyTriage(b, b.latest).urgencyRank;
  return urgencyA - urgencyB || (Number.isFinite(b.score) ? b.score : -1) - (Number.isFinite(a.score) ? a.score : -1) || String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''));
}
