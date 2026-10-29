/**
 * Samarth Care's deterministic, entirely synthetic demonstration pipeline.
 * No records or notes leave this process. Scores are prioritisation signals,
 * not diagnoses; the illustrative thresholds require clinical validation.
 */
import { extractCues, classifyTriage, compareTriage } from './triage.mjs';
import { mergeDailyObservations } from './observation-merge.mjs';
export { extractCues, classifyTriage } from './triage.mjs';
export const DEMO_DATE = '2026-10-27';
export const MODEL_INFO = Object.freeze({
  name: 'Isolation Forest + personal-baseline rules',
  algorithm: 'Isolation Forest, 48 trees, subsample 128, 9 features',
  reference: 'Liu, Ting & Zhou (2008), Isolation Forest, IEEE ICDM. https://doi.org/10.1109/ICDM.2008.17',
  training: 'Unlabelled observations from each development identity’s first 30 days. Every fourth identity is held out from forest fitting. Baseline warm-up returns unknown priority; no labels fit the forest.',
  nlp: 'Local, hand-authored Hindi / English / Hinglish cue lexicon with bounded negation handling; no external language model or speech service.',
  dataset: 'Internally generated synthetic cohort, seed 1042026; 200 seniors × 90 calendar days. No external patient dataset.',
  limitations: 'Synthetic validation only. Rule thresholds and risk categories are illustrative and have not been clinically validated. Correlated daily observations are not independent trials.',
});

const DAY_MS = 86400000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, precision = 1) => Math.round(value * 10 ** precision) / 10 ** precision;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const valid = (values) => values.filter(Number.isFinite);

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  return Math.sqrt(-2 * Math.log(Math.max(0.000001, random()))) * Math.cos(2 * Math.PI * random());
}

const FIRST_NAMES = ['Meera', 'Rajesh', 'Kamala', 'Arun', 'Sunita', 'Mohan', 'Lakshmi', 'Suresh', 'Asha', 'Vijay', 'Savita', 'Prakash', 'Usha', 'Anil', 'Shanti', 'Ramesh', 'Leela', 'Harish', 'Padma', 'Dinesh'];
const LAST_NAMES = ['Sharma', 'Nair', 'Desai', 'Kapoor', 'Rao', 'Iyer', 'Joshi', 'Singh', 'Mehta', 'Patel'];
const CITIES = ['Delhi', 'Pune', 'Bengaluru', 'Mumbai', 'Jaipur'];
const HEALTHY_NOTES = [
  'Feeling well today. Took medicines and went for a short walk.',
  'No pain or confusion. Appetite is good and slept well.',
  'आज ठीक हूँ। दवाई ली और सुबह टहलने गई।',
  'Sab theek hai. Dard nahi hai, khana achha khaya.',
  'Spoke with family. Enjoyed tea and reading this morning.',
  'No fall, no breathlessness. Routine check-in completed.',
  'नींद अच्छी आई। दर्द नहीं है। दवाइयाँ समय पर लीं।',
];

/** Generate 18,000 possible daily observations with realistic gaps and noise. */
export function generateCohort({ seed = 1042026, endDate = DEMO_DATE, seniorCount = 200, days = 90, languageVariant = 'standard' } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Seed must be an unsigned 32-bit integer');
  if (!Number.isInteger(seniorCount) || seniorCount < 1 || seniorCount > 10000) throw new Error('Senior count must be 1–10000');
  if (!Number.isInteger(days) || days < 45 || days > 730) throw new Error('A cohort requires 45–730 calendar days including baseline warm-up');
  if (!['standard', 'held-out-phrases'].includes(languageVariant)) throw new Error('Choose standard or held-out-phrases language templates');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(Date.parse(endDate + 'T00:00:00Z')) || new Date(Date.parse(endDate + 'T00:00:00Z')).toISOString().slice(0,10) !== endDate) throw new Error('Invalid cohort end date');
  const startMs = Date.parse(endDate + 'T00:00:00Z') - (days - 1) * DAY_MS;
  const dateAt = (index) => new Date(startMs + index * DAY_MS).toISOString().slice(0,10);
  const plantedCount = Math.max(1, Math.round(seniorCount * 0.2));
  const activeCount = Math.ceil(plantedCount / 2);
  const random = randomGenerator(seed);
  const seniors = [];
  const records = [];
  const groundTruth = [];
  for (let index = 0; index < seniorCount; index++) {
    const id = `S${String(index + 1).padStart(3, '0')}`;
    const diabetic = index % 4 === 1 || index % 11 === 0;
    const baseline = {
      systolic: round(119 + random() * 20), diastolic: round(70 + random() * 13),
      glucose: round((diabetic ? 125 : 89) + random() * (diabetic ? 27 : 20)),
      spo2: round(96.7 + random() * 1.8), weight: round(51 + random() * 28),
      activity: Math.round(1900 + random() * 3400), sleep: round(6.3 + random() * 1.7),
    };
    const senior = {
      id, name: `${FIRST_NAMES[index % 20]} ${LAST_NAMES[Math.floor(index / 20) % LAST_NAMES.length]}${index >= 200 ? ' ' + (Math.floor(index / 200) + 1) : ''}`,
      age: 62 + (index * 7 % 27), gender: index % 2 ? 'Male' : 'Female',
      city: CITIES[index % CITIES.length], language: index % 3 ? 'Hindi' : 'English',
      coordinator: ['Ananya Verma', 'Kavya Menon', 'Rohan Shah'][index % 3],
      phone: `+91 ••••• •${String(1000 + index).slice(-4)}`,
      family: { name: ['Riya', 'Aditya', 'Neha', 'Rahul'][index % 4] + ' ' + LAST_NAMES[Math.floor(index / 20) % LAST_NAMES.length], relation: index % 2 ? 'Son' : 'Daughter' },
      familyConsent: index % 7 !== 6,
      baseline,
      conditions: [...(diabetic ? ['Diabetes history'] : []), ...(index % 3 === 0 ? ['Blood-pressure monitoring'] : []), ...(index % 8 === 0 ? ['Joint discomfort history'] : [])],
    };
    seniors.push(senior);
    // The first 20 episodes are active at the demonstration date; the next 20
    // resolve earlier. Labels are kept separate and never exposed to scoring.
    const planted = index < plantedCount;
    const onset = index < activeCount ? Math.max(31, days - 12) + index % 5 : Math.max(31, Math.floor(days * 0.48)) + (index * 3 % Math.max(1, Math.floor(days * 0.278)));
    const critical = Math.min(days - 1, onset + 7 + index % 3);
    const end = index < activeCount ? days - 1 : Math.min(days - 4, critical + 5);
    // Pattern assignment is independent of the every-fourth-person holdout.
    // Each split therefore contains all four kinds of planted decline.
    const pattern = ['multisignal', 'medication', 'appetite', 'mobility'][Math.floor(index / 4) % 4];
    if (planted) groundTruth.push({ seniorId: id, pattern, onsetDate: dateAt(onset), criticalDate: dateAt(critical), escalationDate: dateAt(critical), escalationMeaning: 'Synthetic review deadline; no acute event is generated at this date.', endDate: dateAt(end), split: index % 4 === 3 ? 'held-out' : 'development' });
    for (let day = 0; day < days; day++) {
      // Missing whole check-ins as well as individual vitals. Certain seniors
      // have a recent gap, so the UI can demonstrate lower data confidence.
      if ((day > 0 && random() < 0.018) || (index >= 60 && index % 19 === 0 && day >= days - 3)) continue;
      const active = planted && day >= onset && day <= end;
      const progression = active ? clamp((day - onset + 1) / 8, 0, 1.4) : 0;
      const noisyDay = random() < 0.025;
      const medicationMiss = active ? progression * (pattern === 'medication' ? 0.8 : 0.5) : (noisyDay ? 0.4 : 0.025);
      const prescribed = 2 + index % 3;
      let taken = 0;
      for (let dose = 0; dose < prescribed; dose++) if (random() > medicationMiss) taken++;
      const clinicalFactor = pattern === 'multisignal' ? 1 : 0.55;
      const vitals = {
        systolic: round(clamp(baseline.systolic + gaussian(random) * 5 + progression * 28 * clinicalFactor, 95, 196)),
        diastolic: round(clamp(baseline.diastolic + gaussian(random) * 3 + progression * 9, 55, 117)),
        glucose: round(clamp(baseline.glucose + gaussian(random) * 9 + progression * (diabetic ? 73 : 35), 70, 330)),
        spo2: round(clamp(baseline.spo2 + gaussian(random) * 0.45 - progression * (pattern === 'multisignal' ? 5 : 1.4), 87, 100)),
        weight: round(baseline.weight + gaussian(random) * 0.3 - progression * (pattern === 'appetite' ? 3 : 1.2)),
      };
      for (const key of Object.keys(vitals)) if (random() < 0.065) vitals[key] = null;
      const activity = Math.round(clamp(baseline.activity * (1 + gaussian(random) * 0.1 - progression * (pattern === 'mobility' ? 0.58 : 0.36)), 150, 9000));
      const sleep = round(clamp(baseline.sleep + gaussian(random) * 0.35 - progression * 1.75, 2, 10));
      let note = HEALTHY_NOTES[Math.floor(random() * HEALTHY_NOTES.length)];
      if (active && progression >= 0.25) {
        const decliningNotes = {
          multisignal: ['कमजोरी महसूस हो रही है। भूख नहीं लग रही और कल से थोड़ी उलझन है।', 'Feeling weak. Appetite is low and a little confused since yesterday.'],
          medication: ['Do din se dawai bhool gayi. Neend nahi aa rahi aur thakaan hai.', 'Missed medicines again. Sleeping poorly and feeling tired.'],
          appetite: ['Khana kam khaya. Bhookh nahi lagti, akela mehsoos ho raha hai.', 'Eating less this week. Low appetite, feeling lonely and tired.'],
          mobility: ['चलने में दर्द है। कल गिर गई थी। परिवार को नहीं बताया।', 'Had a fall yesterday. Pain when walking and less active today.'],
        };
        const paraphrases = {
          multisignal: ['I feel exhausted and cannot remember where I put things. Off my food.', 'कमजोरी है। याद नहीं आ रहा क्या किया। भूख कम है।'],
          medication: ['The tablets were left untaken. I kept waking up last night.', 'Dawai bhool gayi. Neend kam aayi, thakaan hai.'],
          appetite: ['I have eaten much less and miss having company.', 'Khana kam khaya. Akela lag raha hai.'],
          mobility: ['I lost my balance and landed on the floor. My leg hurts.', 'कल गिर पड़ी। चलने में दर्द है।'],
        };
        note = (languageVariant === 'held-out-phrases' ? paraphrases : decliningNotes)[pattern][(day + index) % 2];
      } else if (noisyDay && index % 6 === 0) note = 'A little tired after visiting family. No pain and no fall.';
      if (random() < 0.08) note = '';
      records.push({
        seniorId: id, date: dateAt(day), vitals,
        medication: { taken, prescribed },
        activity: random() < 0.04 ? null : activity,
        sleep: random() < 0.04 ? null : sleep,
        note, source: day % 5 === 0 ? 'Family check-in' : day % 3 === 0 ? 'Voice check-in' : 'Coordinator call',
      });
    }
  }
  return { seniors, records, groundTruth, metadata: { seed, days, startDate: dateAt(0), endDate, seniorCount, languageVariant, expectedObservations: seniorCount * days, actualObservations: records.length, dataType: 'entirely synthetic' } };
}


function harmonicCorrection(size) {
  if (size <= 1) return 0;
  if (size === 2) return 1;
  return 2 * (Math.log(size - 1) + 0.5772156649) - 2 * (size - 1) / size;
}

/** A dependency-free implementation of the original Isolation Forest method. */
export class IsolationForest {
  constructor({ trees = 48, sampleSize = 128, seed = 104 } = {}) {
    this.treeCount = trees; this.sampleSize = sampleSize; this.seed = seed; this.trees = [];
  }
  fit(vectors) {
    if (!vectors.length) throw new Error('Isolation Forest requires observations');
    const random = randomGenerator(this.seed);
    const sampleSize = Math.min(this.sampleSize, vectors.length);
    this.normalizer = harmonicCorrection(sampleSize) || 1;
    const limit = Math.ceil(Math.log2(sampleSize));
    const makeTree = (points, depth) => {
      if (points.length <= 1 || depth >= limit) return { size: points.length };
      const dimensions = [];
      for (let dimension = 0; dimension < points[0].length; dimension++) {
        let min = Infinity, max = -Infinity;
        for (const point of points) { min = Math.min(min, point[dimension]); max = Math.max(max, point[dimension]); }
        if (max > min) dimensions.push({ dimension, min, max });
      }
      if (!dimensions.length) return { size: points.length };
      const chosen = dimensions[Math.floor(random() * dimensions.length)];
      const split = chosen.min + random() * (chosen.max - chosen.min);
      const left = [], right = [];
      for (const point of points) (point[chosen.dimension] < split ? left : right).push(point);
      return { dimension: chosen.dimension, split, left: makeTree(left, depth + 1), right: makeTree(right, depth + 1) };
    };
    this.trees = Array.from({ length: this.treeCount }, () => {
      const indices = new Set();
      while (indices.size < sampleSize) indices.add(Math.floor(random() * vectors.length));
      return makeTree([...indices].map((index) => vectors[index]), 0);
    });
    return this;
  }
  score(vector) {
    if (!this.trees.length) throw new Error('Isolation Forest must be fitted before scoring');
    let total = 0;
    for (let node of this.trees) {
      let depth = 0;
      while (node.dimension !== undefined) { node = vector[node.dimension] < node.split ? node.left : node.right; depth++; }
      total += depth + harmonicCorrection(node.size);
    }
    return 2 ** (-total / this.trees.length / this.normalizer);
  }
}

function measuredBaseline(records, profile) {
  const baseline = {};
  for (const key of ['systolic', 'diastolic', 'glucose', 'spo2', 'weight']) baseline[key] = round(median(records.map((record) => record.vitals?.[key])) ?? profile.baseline[key]);
  for (const key of ['activity', 'sleep']) baseline[key] = round(median(records.map((record) => record[key])) ?? profile.baseline[key]);
  return baseline;
}

function features(recent, baseline) {
  const aggregate = (key) => mean(valid(recent.map((record) => record.vitals?.[key])));
  const avgActivity = mean(valid(recent.map((record) => record.activity)));
  const avgSleep = mean(valid(recent.map((record) => record.sleep)));
  const prescribed = recent.reduce((sum, record) => sum + (record.medication?.prescribed || 0), 0);
  const taken = recent.reduce((sum, record) => sum + (record.medication?.taken || 0), 0);
  const allCues = recent.flatMap((record) => extractCues(record.note));
  const cues = [...new Map(allCues.map((cue) => [cue.cue, cue])).values()];
  const current = {
    systolic: aggregate('systolic'), diastolic: aggregate('diastolic'), glucose: aggregate('glucose'),
    spo2: aggregate('spo2'), weight: aggregate('weight'), activity: avgActivity, sleep: avgSleep,
    adherence: prescribed ? taken / prescribed : null,
  };
  const vector = [
    ((current.systolic ?? baseline.systolic) - baseline.systolic) / 6,
    ((current.diastolic ?? baseline.diastolic) - baseline.diastolic) / 4,
    ((current.glucose ?? baseline.glucose) - baseline.glucose) / 12,
    (baseline.spo2 - (current.spo2 ?? baseline.spo2)) / 0.65,
    (baseline.weight - (current.weight ?? baseline.weight)) / 0.6,
    (1 - (current.activity ?? baseline.activity) / baseline.activity) / 0.15,
    (baseline.sleep - (current.sleep ?? baseline.sleep)) / 0.5,
    (1 - (current.adherence ?? 1)) * 4,
    cues.reduce((sum, cue) => sum + cue.severity, 0) / 3,
  ];
  return { vector, current, cues, allCues };
}

export function createEngine(cohort = generateCohort(), { modelEnabled = true } = {}) {
  const defaultDate = cohort.metadata?.endDate || DEMO_DATE;
  const startDate = cohort.metadata?.startDate || [...cohort.records].map(record => record.date).sort()[0] || new Date(Date.parse(defaultDate + 'T00:00:00Z') - 89 * DAY_MS).toISOString().slice(0,10);
  const startMs = Date.parse(startDate + 'T00:00:00Z');
  const dayIndex = (date) => Math.floor((Date.parse(date + 'T00:00:00Z') - startMs) / DAY_MS);
  const dateAt = (index) => new Date(startMs + index * DAY_MS).toISOString().slice(0,10);
  const cohortDays = cohort.metadata?.days || dayIndex(defaultDate) + 1;
  const profiles = new Map(cohort.seniors.map((senior) => [senior.id, senior]));
  const recordsBySenior = new Map(cohort.seniors.map((senior) => [senior.id, []]));
  for (const record of cohort.records) recordsBySenior.get(record.seniorId)?.push(record);
  for (const records of recordsBySenior.values()) records.sort((a, b) => a.date.localeCompare(b.date));
  const baselineBySenior = new Map();
  const training = [];
  for (let index = 0; index < cohort.seniors.length; index++) {
    const profile = cohort.seniors[index];
    const rows = recordsBySenior.get(profile.id).filter((record) => dayIndex(record.date) < 30);
    const baseline = measuredBaseline(rows, profile);
    baselineBySenior.set(profile.id, baseline);
    // Every fourth identity is held out completely from ML fitting.
    if (index % 4 !== 3) for (let day = 3; day < 30; day += 2) {
      const recent = rows.filter((record) => { const at = dayIndex(record.date); return at <= day && at > day - 3; });
      if (recent.length) training.push(features(recent, baseline).vector);
    }
  }
  const forest = new IsolationForest().fit(training);
  const baseCache = new Map();

  function scoreCore(id, date = defaultDate, extraRecords = []) {
    const profile = profiles.get(id);
    if (!profile) throw new Error(`Unknown senior: ${id}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dayIndex(date)) || new Date(Date.parse(date+'T00:00:00Z')).toISOString().slice(0,10) !== date) throw new Error('Invalid observation date');
    const relevantExtras = extraRecords.filter((record) => record?.seniorId === id && /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') && record.date <= date);
    const cacheKey = `${id}:${date}`;
    if (!relevantExtras.length && baseCache.has(cacheKey)) return baseCache.get(cacheKey);
    const rawRecords = [...recordsBySenior.get(id).filter((record) => record.date <= date),...relevantExtras];
    const combined = mergeDailyObservations(rawRecords,{seniorId:id,asOfDate:date});
    const latest = combined.at(-1) || null;
    const cutoff = dayIndex(date);
    const recent = combined.filter((record) => dayIndex(record.date) > cutoff - 3);
    const warmup = cutoff < 30;
    const baseline = warmup ? Object.fromEntries(['systolic','diastolic','glucose','spo2','weight','activity','sleep'].map(key => [key, null])) : baselineBySenior.get(id);
    const availableReferences = warmup ? profile.baseline : baseline;
    const { vector, current, cues, allCues } = features(recent, availableReferences);
    const anomalyScore = warmup || !modelEnabled ? null : forest.score(vector);
    const observedSignals = recent.reduce((count, record) => count + Object.values(record.vitals || {}).filter(Number.isFinite).length + Number(Number.isFinite(record.activity)) + Number(Number.isFinite(record.sleep)) + Number(Number.isFinite(record.medication?.taken) && Number.isFinite(record.medication?.prescribed)) + Number(!!record.note), 0);
    const confidence = Math.round(clamp(observedSignals / 27 * 100, 0, 100));
    const recentGroups = [recent.some(record => Object.values(record.vitals || {}).some(Number.isFinite)), recent.some(record => Number.isFinite(record.medication?.taken) && record.medication?.prescribed > 0), recent.some(record => Number.isFinite(record.activity) || Number.isFinite(record.sleep)), recent.some(record => !!record.note)].filter(Boolean).length;
    const sufficientSupport = observedSignals >= 6 && recentGroups >= 2;
    // A later normal reading cannot erase an earlier severe raw measurement.
    const triageRecords = [...rawRecords.filter(record=>dayIndex(record.date)>cutoff-3), ...(latest && !recent.includes(latest) ? [latest] : [])];
    const immediate = classifyTriage({ cues }, triageRecords);
    if (warmup) {
      const warmupResult = { ...profile, asOfDate: date, baseline, score: immediate.immediateReview ? 60 : null, level: immediate.immediateReview ? 'high' : 'unknown', warmup: true,
        reasons: [{ title: 'Personal reference is still being established', detail: 'The first 30 calendar days are a warm-up period. No future observations or fitted baseline are used for this historical priority.', source: 'data' }, ...immediate.triageEvidence.map(item => ({ title: 'A reported concern needs human review', detail: item.detail, source: ['oxygen-reading','pressure-reading','glucose-reading'].includes(item.id)?'vitals':item.id==='sensor-fall'?'sensor':'notes' }))],
        action: immediate.immediateReview ? immediate.triageAction : 'Call to confirm wellbeing and review reported concerns while the personal reference is being established.',
        anomalyScore: null, confidence, lastCheckIn: latest?.date || null, latest, cues, current, adherence: current.adherence == null ? null : Math.round(current.adherence * 100),
        dataFreshness: { ageDays: latest ? Math.max(0, cutoff-dayIndex(latest.date)) : null, observedSignals, expectedSignals: 27, sufficientSupport, label: 'Baseline warm-up' },
        model: { name: MODEL_INFO.name, status: 'warming-up', trainingSamples: 0, trees: 48, features: 9 },
        ...classifyTriage({ level: immediate.immediateReview ? 'high' : 'unknown', score: immediate.immediateReview ? 60 : null, cues, warmup: true }, triageRecords),
      };
      if (!relevantExtras.length) baseCache.set(cacheKey, warmupResult);
      return warmupResult;
    }
    let score = 0;
    const reasons = [];
    const add = (points, title, detail, source) => { score += points; reasons.push({ points, title, detail, source }); };
    const latestSpo2 = latest?.vitals?.spo2;
    const latestSystolic = latest?.vitals?.systolic;
    const latestDiastolic = latest?.vitals?.diastolic;
    const latestGlucose = latest?.vitals?.glucose;
    if (latestSpo2 != null && latestSpo2 < 90) add(55, 'Oxygen reading needs immediate review', `Latest SpO₂ ${latestSpo2}%; usual level ${baseline.spo2}%. Verify the reading and assess promptly.`, 'vitals');
    else if (current.spo2 != null && current.spo2 < 92) add(36, 'Oxygen is below their usual range', `Three-day average SpO₂ ${round(current.spo2)}% versus ${baseline.spo2}% baseline.`, 'vitals');
    else if (current.spo2 != null && baseline.spo2 - current.spo2 > 2) add(18, 'Oxygen readings have fallen', `SpO₂ is ${round(baseline.spo2 - current.spo2)} points below personal baseline.`, 'vitals');
    if (latestSystolic >= 180 || latestDiastolic >= 120) add(45, 'Blood-pressure reading needs prompt review', `Latest reading ${latestSystolic}/${latestDiastolic ?? '—'} mmHg. Recheck and route to a clinician.`, 'vitals');
    else if (current.systolic != null && (current.systolic - baseline.systolic > 20 || current.systolic >= 160)) add(17, 'Blood pressure is trending up', `Three-day systolic average ${Math.round(current.systolic)} mmHg; usual ${baseline.systolic} mmHg.`, 'vitals');
    else if (current.systolic != null && current.systolic - baseline.systolic > 12) add(8, 'Blood pressure is above baseline', `${Math.round(current.systolic)} mmHg compared with a usual ${baseline.systolic} mmHg.`, 'vitals');
    if (current.systolic != null && baseline.systolic - current.systolic > 30) add(60, 'Blood pressure has fallen well below personal baseline', `Three-day systolic average ${Math.round(current.systolic)} mmHg versus ${baseline.systolic} mmHg usual. Verify the readings and arrange a human clinical review.`, 'vitals');
    else if (current.systolic != null && baseline.systolic - current.systolic > 15) add(30, 'Blood pressure has fallen from personal baseline', `${Math.round(current.systolic)} mmHg versus ${baseline.systolic} mmHg usual; ask about context and verify.`, 'vitals');
    if (latestGlucose != null && (latestGlucose >= 300 || latestGlucose < 70)) add(40, 'Glucose reading needs prompt review', `Latest glucose ${latestGlucose} mg/dL. Verify and contact the clinical care team.`, 'vitals');
    else if (current.glucose != null && current.glucose - baseline.glucose > 40) add(15, 'Glucose has risen from baseline', `Three-day average ${Math.round(current.glucose)} mg/dL versus ${baseline.glucose} mg/dL usual.`, 'vitals');
    else if (current.glucose != null && baseline.glucose - current.glucose > 40) add(30, 'Glucose has fallen from personal baseline', `Three-day average ${Math.round(current.glucose)} mg/dL versus ${baseline.glucose} mg/dL usual. Confirm meal and measurement context with the care team.`, 'vitals');
    if (current.adherence != null && current.adherence < 0.6) add(22, 'Several medicine doses missed', `${Math.round(current.adherence * 100)}% of prescribed doses recorded as taken over three days.`, 'medication');
    else if (current.adherence != null && current.adherence < 0.8) add(12, 'Medicine routine needs a check-in', `${Math.round(current.adherence * 100)}% adherence over the last three days.`, 'medication');
    else if (current.adherence != null && current.adherence < 0.95) add(5, 'A recent medicine dose was missed', `${Math.round(current.adherence * 100)}% of recorded doses were taken.`, 'medication');
    const activityDrop = current.activity == null ? 0 : 1 - current.activity / baseline.activity;
    if (activityDrop > 0.35) add(16, 'Activity is well below their usual level', `${Math.round(activityDrop * 100)}% fewer daily steps than their ${Math.round(baseline.activity).toLocaleString('en-IN')}-step baseline.`, 'activity');
    else if (activityDrop > 0.2) add(8, 'Daily movement has reduced', `${Math.round(activityDrop * 100)}% below personal activity baseline.`, 'activity');
    const sleepLoss = current.sleep == null ? 0 : baseline.sleep - current.sleep;
    if (sleepLoss > 1.5) add(12, 'Sleep has reduced noticeably', `${round(current.sleep)} hours a night, down from ${baseline.sleep} hours usual.`, 'activity');
    else if (sleepLoss > 0.8) add(6, 'Sleep is below their normal pattern', `${round(sleepLoss)} fewer hours per night over the last three days.`, 'activity');
    else if (sleepLoss < -2) add(15, 'Sleep duration has increased from the usual routine', `${round(-sleepLoss)} more logged hours per night than the personal reference. Ask about rest, daytime sleep and routine changes.`, 'activity');
    if (activityDrop < -0.8) add(8, 'Movement entries are unusually high for this person', 'Logged movement is more than 80% above the personal reference. Confirm the device or entry and ask about routine changes.', 'activity');
    const weightLoss = current.weight == null ? 0 : baseline.weight - current.weight;
    if (weightLoss > 2.2) add(12, 'Weight has fallen from baseline', `${round(weightLoss)} kg below the initial 30-day baseline; check intake and request a review.`, 'vitals');
    else if (weightLoss > 1.2) add(6, 'Weight is trending down', `${round(weightLoss)} kg below their usual weight.`, 'vitals');
    const notePoints = { chest_pain: 55, breathlessness: 50, fall: 37, confusion: 24, low_appetite: 10, poor_sleep: 7, missed_medication: 8, pain: 8, loneliness: 6, fatigue: 5 };
    for (const cue of cues) add(notePoints[cue.cue] || 0, cue.label, `Check-in: “${cue.evidence}”`, 'notes');
    if (cues.some((cue) => allCues.filter((other) => other.cue === cue.cue).length >= 2)) add(7, 'Changes persist across check-ins', 'The same wellbeing change appears in more than one recent check-in.', 'notes');
    const modelPoints = anomalyScore == null ? 0 : Math.max(0, Math.min(22, (anomalyScore - 0.52) * 95));
    score += modelPoints;
    if (modelPoints >= 6) reasons.push({ points: modelPoints, title: 'An unusual combination of changes', detail: `Isolation Forest identifies a pattern outside the initial 30-day observations (anomaly score ${round(anomalyScore, 2)}).`, source: 'model' });
    const ageDays = latest ? Math.max(0, cutoff - dayIndex(latest.date)) : 90;
    if (ageDays >= 3) add(30, 'Check-in overdue', `No recorded check-in for ${ageDays} days. Confirm wellbeing; missing data is not evidence of good health.`, 'data');

    const urgentReading = (latestSpo2 != null && latestSpo2 < 90) || latestSystolic >= 180 || latestDiastolic >= 120 || (latestGlucose != null && (latestGlucose < 70 || latestGlucose >= 300));
    const urgentSymptoms = cues.some((cue) => ['chest_pain', 'breathlessness'].includes(cue.cue));
    // A severe individual signal must remain visible at high priority even
    // when the three-day aggregate is diluted by earlier routine readings.
    if (urgentReading || urgentSymptoms || immediate.immediateReview) score = Math.max(score, 60);
    score = Math.round(clamp(score, 0, 100));
    const observedConcern = cues.length > 0 || immediate.immediateReview || reasons.some(reason => reason.source !== 'data' && reason.source !== 'model' && reason.points > 0);
    const unknown = !sufficientSupport && !observedConcern;
    if (unknown) score = null;
    else if (!sufficientSupport && observedConcern && score < 30) score = 30;
    const level = unknown ? 'unknown' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
    const urgentCue = cues.some((cue) => ['chest_pain', 'breathlessness', 'fall'].includes(cue.cue));
    let action = level === 'high' ? 'Call today to confirm the changes, involve the care team and arrange a clinician review.' : level === 'medium' ? 'Schedule a check-in today, verify the reported changes and agree a follow-up with the senior.' : 'Continue routine check-ins and the agreed care plan.';
    if (urgentCue || urgentReading || immediate.immediateReview) action = immediate.triageAction;
    else if (cues.some((cue) => cue.cue === 'missed_medication') || (current.adherence != null && current.adherence < 0.6)) action = 'Call today to understand missed doses and arrange a medicine review with the care team. Do not change medicines without a clinician.';
    if ((ageDays >= 3 && score < 60) || unknown) action = 'Call the senior or their agreed contact to confirm wellbeing and collect missing observations; current priority is not established.';
    if (immediate.immediateReview) for (const evidence of immediate.triageEvidence) {
      if (!reasons.some(reason => reason.detail.includes(evidence.detail))) reasons.push({ points: 35, title: evidence.id === 'help-request' ? 'The senior requested help' : 'A reported signal needs prompt human review', detail: evidence.detail, source: ['oxygen-reading','pressure-reading','glucose-reading'].includes(evidence.id)?'vitals':evidence.id === 'sensor-fall' ? 'sensor' : 'notes' });
    }
    if (unknown) {
      reasons.length = 0;
      reasons.push({ points: 0, title: 'Insufficient recent observations', detail: `${observedSignals} of 27 expected signal fields are available across ${recentGroups} signal groups. Missing entries do not establish stability.`, source: 'data' });
    }
    if (!reasons.length) reasons.push({ points: 0, title: 'Stable against personal baseline', detail: 'Recent recorded signals are within this senior’s usual pattern.', source: 'baseline' });
    const result = {
      ...profile, asOfDate: date, baseline, score, level, warmup: false,
      reasons: reasons.sort((a, b) => b.points - a.points).slice(0, 5).map(({ points, ...reason }) => reason),
      action, anomalyScore: anomalyScore == null ? null : round(anomalyScore, 3), confidence,
      ...classifyTriage({ score, level, cues, immediateReview: immediate.immediateReview }, triageRecords),
      lastCheckIn: latest?.date || null,
      latest: latest ? { ...latest, cues: extractCues(latest.note) } : null,
      cues, dataFreshness: { ageDays, observedSignals, expectedSignals: 27, sufficientSupport, label: ageDays >= 3 ? 'Check-in overdue' : confidence < 60 ? 'Some signals missing' : 'Recent signals available' },
      adherence: current.adherence == null ? null : Math.round(current.adherence * 100),
      current: Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value == null ? null : round(value)])),
      model: { name: MODEL_INFO.name, trainingSamples: training.length, trees: 48, features: 9 },
    };
    if (!relevantExtras.length) baseCache.set(cacheKey, result);
    return result;
  }

  function scoreSenior(id, date = defaultDate, extraRecords = []) {
    const result = scoreCore(id, date, extraRecords);
    const to = dayIndex(date);
    const trend = [];
    for (let day = Math.max(30, to - 13); day <= to; day++) {
      const point = scoreCore(id, dateAt(day), extraRecords);
      trend.push({ date: dateAt(day), score: point.score });
    }
    return { ...result, trend };
  }

  function rankSeniors(date = defaultDate, extraRecords = []) {
    // A seven-day compact trend for the roster avoids computing full detail
    // histories until the coordinator opens a particular senior.
    const cutoff = dayIndex(date);
    return cohort.seniors.map((senior) => {
      const result = scoreCore(senior.id, date, extraRecords);
      const trend = [];
      for (let day = Math.max(30, cutoff - 6); day <= cutoff; day++) trend.push({ date: dateAt(day), score: scoreCore(senior.id, dateAt(day), extraRecords).score });
      return { ...result, trend };
    }).sort(compareTriage);
  }

  let cachedMetrics;
  function metrics({ includeAblation = true } = {}) {
    if (cachedMetrics && (!includeAblation || !modelEnabled || cachedMetrics.ablation)) return cachedMetrics;
    const heldOut = cohort.seniors.filter((_, index) => index % 4 === 3);
    const heldOutIds = new Set(heldOut.map(senior => senior.id));
    const episodes = cohort.groundTruth.filter(episode => heldOutIds.has(episode.seniorId));
    const totals = { truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0, unknownSeniorDays: 0 };
    const patternTotals = new Map();
    const caseResults = [], leads = [], delays = [];
    function count(target, actual, predicted, unknown) {
      if (actual && predicted) target.truePositives++;
      else if (actual) target.falseNegatives++;
      else if (predicted) target.falsePositives++;
      else target.trueNegatives++;
      if (unknown) target.unknownSeniorDays++;
    }
    const rates = value => ({
      precision: value.truePositives + value.falsePositives ? round(value.truePositives / (value.truePositives + value.falsePositives),3) : null,
      recall: value.truePositives + value.falseNegatives ? round(value.truePositives / (value.truePositives + value.falseNegatives),3) : null,
      f1: 2*value.truePositives + value.falsePositives + value.falseNegatives ? round(2*value.truePositives/(2*value.truePositives+value.falsePositives+value.falseNegatives),3) : null,
    });
    for (const senior of heldOut) {
      const episode = episodes.find(item => item.seniorId === senior.id);
      let firstAlert = null;
      const pattern = episode ? patternTotals.get(episode.pattern) || { pattern: episode.pattern, ...Object.fromEntries(Object.keys(totals).map(key=>[key,0])), episodes:0, detectedCases:0, leadDays:[], detectionDelays:[] } : null;
      if (pattern) { pattern.episodes++; patternTotals.set(episode.pattern,pattern); }
      for (let day = 30; day < cohortDays; day++) {
        const date = dateAt(day);
        const result = scoreCore(senior.id, date);
        const actual = !!episode && date >= episode.onsetDate && date <= episode.endDate;
        const predicted = result.score != null && result.score >= 60;
        count(totals, actual, predicted, result.level === 'unknown');
        if (pattern) count(pattern, actual, predicted, result.level === 'unknown');
        if (actual && predicted && !firstAlert) firstAlert = date;
      }
      if (episode) {
        const escalationDate = episode.escalationDate || episode.criticalDate;
        const leadDays = firstAlert ? dayIndex(escalationDate) - dayIndex(firstAlert) : null;
        const detectionDelayDays = firstAlert ? dayIndex(firstAlert) - dayIndex(episode.onsetDate) : null;
        if (leadDays != null) { leads.push(leadDays); delays.push(detectionDelayDays); pattern.detectedCases++; pattern.leadDays.push(leadDays); pattern.detectionDelays.push(detectionDelayDays); }
        caseResults.push({ seniorId: senior.id, pattern:episode.pattern, onsetDate:episode.onsetDate, criticalDate:escalationDate, escalationDate, firstAlertDate:firstAlert, leadDays, detectionDelayDays, detected:!!firstAlert });
      }
    }
    const evaluatedDays = Math.max(0,cohortDays-30);
    const expectedObservations = cohort.metadata?.expectedObservations || cohort.seniors.length*cohortDays;
    const result = {
      ...totals,...rates(totals),
      meanLeadDays: leads.length ? round(mean(leads),1) : null,
      medianLeadDays: leads.length ? round(median(leads),1) : null,
      leadTimeLabel:'Days before planted escalation deadline',
      leadTimeMeaning:'Planted escalation is a synthetic review deadline, not an observed acute event or the start of decline.',
      meanOnsetDetectionDelayDays:delays.length?round(mean(delays),1):null,
      caseRecall:episodes.length?round(leads.length/episodes.length,3):null,
      detectedCases:leads.length,totalCases:episodes.length,
      heldOutSeniors:heldOut.length,developmentSeniors:cohort.seniors.length-heldOut.length,
      evaluatedDays,evaluatedSeniorDays:heldOut.length*evaluatedDays,
      threshold:60,trainingSamples:training.length,
      totalSeniors:cohort.seniors.length,totalDays:cohortDays,observations:cohort.records.length,
      plantedCases:cohort.groundTruth.length,missingObservationRate:round(1-cohort.records.length/expectedObservations,4),
      modelEnabled, model:MODEL_INFO,
      perPattern:[...patternTotals.values()].map(({leadDays,detectionDelays,...pattern})=>({...pattern,...rates(pattern),caseRecall:pattern.episodes?round(pattern.detectedCases/pattern.episodes,3):null,meanLeadDays:leadDays.length?round(mean(leadDays),1):null,meanOnsetDetectionDelayDays:detectionDelays.length?round(mean(detectionDelays),1):null})),
      methodology:`The forest uses only the first 30 days of development identities, without labels. Every fourth senior is held out from forest fitting and uses their own first 30-day reference. Evaluation covers days 31–${cohortDays} at score>=60. Unknown days remain in the denominators and are counted as unflagged. Positive senior-days lie in planted onset-to-end intervals. Lead time is synthetic escalation deadline minus first high flag during that interval; onset delay is first high flag minus onset. Per-pattern rates describe planted-case identities only. Synthetic labels never enter scoring. No clinical performance or future-event prediction is established.`,
      caseResults,
    };
    if (includeAblation && modelEnabled) {
      const baselineMetrics = createEngine(cohort,{modelEnabled:false}).metrics({includeAblation:false});
      result.ablation = { comparison:'Same cohort, split, dates, thresholds, NLP and rules; only the anomaly contribution is disabled.', rulesOnly:{...rates(baselineMetrics),meanLeadDays:baselineMetrics.meanLeadDays,meanOnsetDetectionDelayDays:baselineMetrics.meanOnsetDetectionDelayDays,detectedCases:baselineMetrics.detectedCases,totalCases:baselineMetrics.totalCases}, rulesPlusModel:{...rates(result),meanLeadDays:result.meanLeadDays,meanOnsetDetectionDelayDays:result.meanOnsetDetectionDelayDays,detectedCases:result.detectedCases,totalCases:result.totalCases} };
    }
    cachedMetrics=result;
    return result;
  }

  return { scoreSenior, rankSeniors, metrics, cohort, forest, modelInfo: MODEL_INFO };
}

/** Repeated synthetic stress tests, not an independently collected clinical set. */
export function evaluateRobustness({ seeds = [1042026, 1042027, 1042028], languageVariants = ['standard', 'held-out-phrases'], seniorCount = 200, days = 90, endDate = DEMO_DATE } = {}) {
  if (!Array.isArray(seeds) || !seeds.length || seeds.length > 10 || !Array.isArray(languageVariants) || !languageVariants.length || languageVariants.length > 3) throw new Error('Choose 1–10 seeds and 1–3 phrase variants');
  const runs = [];
  for (const seed of seeds) for (const languageVariant of languageVariants) {
    const cohort = generateCohort({ seed, languageVariant, seniorCount, days, endDate });
    const metrics = createEngine(cohort).metrics();
    runs.push({ seed, languageVariant, ...Object.fromEntries(['precision','recall','f1','truePositives','falsePositives','falseNegatives','trueNegatives','unknownSeniorDays','meanLeadDays','meanOnsetDetectionDelayDays','detectedCases','totalCases','evaluatedSeniorDays'].map(key=>[key,metrics[key]])), perPattern:metrics.perPattern, ablation:metrics.ablation });
  }
  const range = (key) => {
    const values = runs.map(run=>run[key]).filter(Number.isFinite);
    return { min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,mean:values.length?round(mean(values),3):null };
  };
  const probes = [
    { text:'My daughter fell yesterday but I am fine.', expected:[] },
    { text:'My mother fell yesterday.', expected:['fall'] },
    { text:'नींद कम आई।', expected:['poor_sleep'] },
    { text:'Yaad nahi aa raha kya kiya.', expected:['confusion'] },
    { text:'No pain or confusion. No fall.', expected:[] },
    { text:'Neend kam nahi aayi.', expected:[] },
    { text:'I kept waking up and ate less.', expected:['poor_sleep','low_appetite'] },
    { text:'The tablets were left untaken.', expected:['missed_medication'] },
  ].map(probe=>({...probe,actual:extractCues(probe.text).map(cue=>cue.cue)})).map(probe=>({...probe,passed:probe.actual.length===probe.expected.length && probe.expected.every(cue=>probe.actual.includes(cue))}));
  return {
    description:'Repeat identity-held-out evaluation on multiple independently seeded synthetic cohorts and alternative hand-authored phrase templates. Each forest is fitted on that cohort’s development baseline only.',
    limitations:'These are transparent robustness probes, not a sequestered blind NLP dataset or independent patient validation. Generator patterns, templates and detector rules are authored in this repository. Senior-days are correlated; aggregate ranges are not clinical confidence intervals.',
    runCount:runs.length,seeds,languageVariants,seniorCount,days,runs,
    ranges:{precision:range('precision'),recall:range('recall'),f1:range('f1'),meanLeadDays:range('meanLeadDays'),meanOnsetDetectionDelayDays:range('meanOnsetDetectionDelayDays')},
    languageProbes:{passed:probes.filter(probe=>probe.passed).length,total:probes.length,probes},
  };
}
