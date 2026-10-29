/** Shared local note understanding and prioritisation. No diagnostic probabilities. */
export const URGENCY_RANK = Object.freeze({ immediate: 0, today: 1, unknown: 2, routine: 3 });

const LEXICON = [
  { cue: 'chest_pain', label: 'Chest discomfort mentioned', severity: 4, patterns: [/chest\s+(?:pain|discomfort|tightness|hurts?)/iu, /सीने\s*(?:में)?\s*दर्द/u, /seene?\s*(?:mein)?\s*dard/iu] },
  { cue: 'breathlessness', label: 'Breathing difficulty mentioned', severity: 4, patterns: [/breathless(?:ness)?/iu, /short(?:ness)?\s+of\s+breath/iu, /(?:difficulty|trouble)\s+breathing/iu, /(?:cannot|can't)\s+(?:catch\s+(?:my\s+)?breath|breathe)/iu, /सांस\s*(?:लेने\s*)?(?:में\s*)?(?:दिक्कत|तकलीफ)/u, /saans\s*(?:mein\s*)?(?:dikkat|takleef)/iu] },
  { cue: 'fall', label: 'A fall mentioned', severity: 4, patterns: [/\b(?:fall|fell|fallen|tumbled)\b/iu, /गिर\s*(?:गई|गया|गए|पड़ी|पड़ा)/u, /\b(?:gir\s+(?:gayi|gaya|gaye)|girne)\b/iu, /lost\s+(?:my\s+)?balance\s+and\s+(?:landed|hit)/iu] },
  { cue: 'confusion', label: 'Confusion or disorientation', severity: 3, intrinsicNegation: true, patterns: [/confus(?:ed|ion)/iu, /disorient(?:ed|ation)/iu, /उलझन|भ्रम/u, /\buljhan\b/iu, /yaad\s+nahi\s+(?:aa|a|aata|aati)/iu, /याद\s*नहीं\s*(?:आ|है)/u, /(?:cannot|can't)\s+remember\s+(?:where|which|what|who)/iu, /(?:not\s+sure|unsure)\s+where\s+(?:I|she|he)\s+(?:am|is)/iu] },
  { cue: 'low_appetite', label: 'Low appetite or eating less', severity: 2, intrinsicNegation: true, patterns: [/low\s+appetite/iu, /(?:poor|reduced|no)\s+appetite/iu, /(?:eating|ate|eaten)\s+(?:much\s+)?less/iu, /not\s+eating/iu, /भूख\s*(?:नहीं|कम)/u, /(?:खाना|खाया)\s*कम/u, /khana\s+kam/iu, /bhookh?\s+(?:nahi|kam)/iu, /off\s+(?:my|her|his|their)\s+food/iu] },
  { cue: 'poor_sleep', label: 'Poor or reduced sleep', severity: 2, intrinsicNegation: true, patterns: [/sleep(?:ing)?\s+(?:poorly|badly|less)/iu, /poor\s+sleep/iu, /not\s+sleeping/iu, /slept\s+(?:much\s+)?less/iu, /kept\s+waking\s+up/iu, /नींद\s*(?:नहीं|कम|खराब)/u, /neend\s+(?:nahi|kam|kharab)/iu] },
  { cue: 'missed_medication', label: 'Missed medicines mentioned', severity: 2, intrinsicNegation: true, patterns: [/missed\s+(?:\w+\s+)?(?:medicin\w*|medicatio\w*|dose\w*)/iu, /forgot\s+(?:\w+\s+)?(?:medicin\w*|medicatio\w*|dose\w*)/iu, /दवा(?:ई|इयाँ|इयां)?\s*(?:लेना\s*)?(?:भूल|नहीं)/u, /dawai\s+(?:bhool|nahi)/iu, /(?:tablets?|pills?)\s+(?:were\s+)?(?:left\s+untaken|not\s+taken)/iu] },
  { cue: 'pain', label: 'Pain or discomfort', severity: 2, patterns: [/\bpain\b/iu, /\b(?:dard|discomfort|aching|hurts?)\b/iu, /दर्द/u] },
  { cue: 'loneliness', label: 'Loneliness or isolation', severity: 1, patterns: [/lonel(?:y|iness)/iu, /feel(?:ing)?\s+alone/iu, /अकेलापन|अकेला|अकेली/u, /\bakela\b/iu, /miss\s+having\s+company/iu] },
  { cue: 'fatigue', label: 'Tiredness or weakness', severity: 1, patterns: [/\b(?:tired|fatigue|weak|weakness|exhausted)\b/iu, /कमजोरी|थकान/u, /\b(?:thakaan|kamzori)\b/iu] },
];
const cueMemo = new Map();
function mentionsOtherSubject(clause, matchIndex) {
  const before = clause.slice(0, matchIndex);
  // First/third-person care notes and family reports about mother/father remain
  // eligible. Explicit child/spouse/friend subjects are not the senior unless
  // the sentence subsequently switches back to the senior's own experience.
  const other = /\b(?:my|his|her|their)\s+(?:daughter|son|wife|husband|friend|neighbou?r|grandchild|granddaughter|grandson)\b|(?:मेरी|मेरा|मेरे)\s*(?:बेटी|बेटा|पत्नी|पति|दोस्त|पड़ोसी)/giu;
  let lastOther = null;
  for (const match of before.matchAll(other)) lastOther = match;
  if (!lastOther) return false;
  const since = before.slice(lastOther.index + lastOther[0].length);
  return !/\b(?:I|myself|the\s+senior|the\s+patient|mother|father|mum|mom|dad)\b|(?:मुझे|मैं|वरिष्ठ)/iu.test(since);
}

/** Hand-authored multilingual rules, including limited subject and negation checks. */
export function extractCues(text = '') {
  if (typeof text !== 'string' || !text.trim()) return [];
  if (cueMemo.has(text)) return cueMemo.get(text);
  const clauses = text.normalize('NFKC').split(/[.!?।;\n]|\bbut\b|\blekin\b|लेकिन/iu).filter(Boolean);
  const found = [];
  for (const entry of LEXICON) {
    let evidence;
    for (const clause of clauses) {
      for (const expression of entry.patterns) {
        // Inspect all occurrences so "no pain earlier, pain now" can retain a
        // later positive mention instead of stopping at the first negation.
        const allMatches = new RegExp(expression.source, expression.flags.includes('g') ? expression.flags : expression.flags + 'g');
        for (const match of clause.matchAll(allMatches)) {
          if (mentionsOtherSubject(clause, match.index)) continue;
          const before = clause.slice(Math.max(0, match.index - 35), match.index);
          const after = clause.slice(match.index + match[0].length, match.index + match[0].length + 24);
          const negatedBefore = /\b(?:no|not|without|denies|denied|never)\b(?:\s+\w+){0,3}\s*$/iu.test(before) || /(?:नहीं|नही)\s*$/u.test(before);
          const negatedAfter = /^\s*(?:(?:nahi|nahin|naheen|nai)\b|नहीं|नही)/iu.test(after);
          const conditional = /\b(?:if|watch\s+for|in\s+case\s+of|might|may)\b/iu.test(before);
          if (conditional || negatedBefore || negatedAfter) continue;
          evidence = clause.trim().slice(0, 180);
          break;
        }
        if (evidence) break;
      }
      if (evidence) break;
    }
    if (evidence) found.push({ cue: entry.cue, label: entry.label, severity: entry.severity, evidence, subject: 'senior-or-care-subject', attribution: 'bounded rule; confirm with the reporter' });
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
    if (item?.sensor?.fallDetected === true || (item?.sensor?.impactG >= 2.5 && item?.sensor?.postureChange === true)) evidence.push({ id: 'sensor-fall', detail: 'A submitted device flag needs human verification; no fall is confirmed.' });
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
