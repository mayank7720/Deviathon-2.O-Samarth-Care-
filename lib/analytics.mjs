/** Local, dependency-free supplementary care analytics. Never diagnoses. */
import { DEMO_DATE, extractCues, MODEL_INFO } from "./engine.mjs";
import { classifyTriage } from "./triage.mjs";
import {mergeDailyObservations,observationRecords} from './observation-merge.mjs';
import {medicationCounts} from './personal-baseline.mjs';

const DAY = 86400000;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const isNumber = Number.isFinite;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round = (value, digits = 1) =>
  Number.isFinite(value)
    ? Math.round(value * 10 ** digits) / 10 ** digits
    : null;
const average = (values) => {
  const observed = values.filter(isNumber);
  return observed.length
    ? observed.reduce((sum, value) => sum + value, 0) / observed.length
    : null;
};
const at = (date) =>
  DAY_FORMAT.test(date || "") ? Date.parse(`${date}T00:00:00Z`) : NaN;
const validDate = (date) =>
  Number.isFinite(at(date)) &&
  new Date(at(date)).toISOString().slice(0, 10) === date;
const daysBetween = (from, to) => Math.round((at(to) - at(from)) / DAY);
const addDays = (date, days) =>
  new Date(at(date) + days * DAY).toISOString().slice(0, 10);
const levelFor = (score) =>
  score == null
    ? "unknown"
    : score >= 60
      ? "high"
      : score >= 30
        ? "medium"
        : "low";
const dateFor = (senior) => {
  if (validDate(senior?.asOfDate)) return senior.asOfDate;
  const trendDates = (senior?.trend || [])
    .map((point) => point.date)
    .filter(validDate)
    .sort();
  return (
    trendDates.at(-1) ||
    (validDate(senior?.latest?.date) ? senior.latest.date : DEMO_DATE)
  );
};

/** Preserve independent same-day fields; append note evidence chronologically. */
export function mergeSeniorRecords(senior, records = []) {
  return mergeDailyObservations(records,{seniorId:senior?.id,asOfDate:dateFor(senior)});
}

/** A descriptive extrapolation of already observed risk, never a disease forecast. */
export function forecastRisk(trend = [], { asOfDate } = {}) {
  const cutoff = validDate(asOfDate) ? asOfDate : null;
  const unique = new Map();
  for (const point of trend)
    if (
      validDate(point?.date) &&
      isNumber(point.score) &&
      point.score >= 0 &&
      point.score <= 100 &&
      (!cutoff || point.date <= cutoff)
    )
      unique.set(point.date, point.score);
  const ordered = [...unique]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, score]) => ({ date, score }));
  const referenceDate = cutoff || ordered.at(-1)?.date;
  const observations = referenceDate ? ordered.filter(point => daysBetween(point.date, referenceDate) < 14) : [];
  const observedSpan = observations.length ? daysBetween(observations[0].date, observations.at(-1).date) + 1 : 0;
  const lastObservationDate = observations.at(-1)?.date || ordered.at(-1)?.date || null;
  const daysSinceLastScore = lastObservationDate && referenceDate ? daysBetween(lastObservationDate, referenceDate) : null;
  const maximumGapDays = observations.reduce((largest, point, index) => index ? Math.max(largest, daysBetween(observations[index - 1].date, point.date)) : largest, 0);
  const method = "linear trend projection";
  const limitations =
    "A descriptive projection of recorded risk scores, not a prediction of illness or an event. Bands use past regression residuals and a minimum width; they are not calibrated medical confidence intervals. A trend change can invalidate the projection.";
  if (
    observations.length < 5 ||
    observedSpan < 5 ||
    daysSinceLastScore > 2 ||
    observations.length / observedSpan < 0.5 ||
    maximumGapDays > 3
  )
    return {
      horizonDays: 3,
      method,
      points: [],
      slopePerDay: null,
      confidenceLabel: "insufficient data",
      observations: observations.length,
      observedSpanDays: observedSpan,
      lastObservationDate,
      daysSinceLastScore,
      maximumGapDays,
      abstentionReason: daysSinceLastScore > 2 ? "Recent scores are stale; collect a fresh observation before projecting." : "At least five recent dated scores with sufficient calendar coverage are required.",
      residualStandardDeviation: null,
      bandInterpretation:
        "Descriptive residual envelope; no medical probability.",
      limitations,
    };
  const start = observations[0].date;
  const xs = observations.map((point) => daysBetween(start, point.date));
  const ys = observations.map((point) => point.score);
  const xMean = average(xs),
    yMean = average(ys);
  const sxx = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  const slope =
    xs.reduce(
      (sum, value, index) => sum + (value - xMean) * (ys[index] - yMean),
      0,
    ) / sxx;
  const intercept = yMean - slope * xMean;
  const squaredResidual = xs.reduce(
    (sum, value, index) => sum + (ys[index] - (intercept + slope * value)) ** 2,
    0,
  );
  const residual = Math.sqrt(
    squaredResidual / Math.max(1, observations.length - 2),
  );
  const lastDate = observations.at(-1).date;
  const gaps = daysBetween(start, lastDate) + 1 - observations.length;
  const confidenceLabel =
    observations.length >= 10 && gaps <= 2 && residual < 12
      ? "more trend support"
      : "limited trend support";
  return {
    horizonDays: 3,
    method,
    slopePerDay: round(slope, 2),
    confidenceLabel,
    observations: observations.length,
    observedSpanDays: observedSpan,
    lastObservationDate,
    daysSinceLastScore,
    maximumGapDays,
    residualStandardDeviation: round(residual, 2),
    bandInterpretation:
      "Descriptive residual envelope; no medical probability.",
    points: [1, 2, 3].map((horizon) => {
      const x = daysBetween(start, referenceDate) + horizon;
      const projected = clamp(intercept + slope * x, 0, 100);
      const width =
        Math.max(8, 1.96 * residual) *
          Math.sqrt(1 + 1 / observations.length + (x - xMean) ** 2 / sxx) +
        Math.min(12, gaps * 2);
      return {
        date: addDays(referenceDate, horizon),
        score: round(projected),
        lower: round(clamp(projected - width, 0, 100)),
        upper: round(clamp(projected + width, 0, 100)),
      };
    }),
    limitations,
  };
}

const stepCount = (record) =>
  isNumber(record?.sensor?.steps)
    ? record.sensor.steps
    : isNumber(record?.lifestyle?.steps)
      ? record.lifestyle.steps
      : record?.activity;
const sleepHours = (record) =>
  isNumber(record?.lifestyle?.sleepHours)
    ? record.lifestyle.sleepHours
    : record?.sleep;
const doseList = (record) =>
  Array.isArray(record?.medication?.doses)
    ? record.medication.doses
    : Array.isArray(record?.doses)
      ? record.doses
      : [];
const doseState = (dose) => {
  const missed = dose?.status === "missed" || dose?.taken === false;
  const taken = dose?.status === "taken" || dose?.taken === true || !!dose?.takenAt;
  if (missed && taken) return "conflicting";
  return taken ? "taken" : missed ? "missed" : "unresolved";
};
const missedDose = (dose) => doseState(dose) === "missed";
const takenDose = (dose) => doseState(dose) === "taken";
const scheduledTime = (dose) =>
  String(dose?.scheduledTime || dose?.time || dose?.scheduledAt || "").trim();
const medicineName = (dose) =>
  String(dose?.name || dose?.medicine || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function medicationAnalysis(rows) {
  const days = [];
  const doses = [];
  let invalidLogs = 0;
  for (const record of rows) {
    const entries = doseList(record).filter(
      (dose) => dose && typeof dose === "object",
    );
    // Core scoring and supplementary analysis share one outcome denominator.
    // A numeric snapshot must not turn explicit pending outcomes into misses.
    const counts = medicationCounts({ ...(record.medication || {}), ...(entries.length ? { doses: entries } : {}) });
    const { invalid } = counts;
    const prescribed = invalid ? 0 : counts.prescribed;
    const taken = invalid ? 0 : counts.taken;
    const unresolved = invalid ? counts.scheduled : counts.unresolved;
    if (invalid) invalidLogs++;
    if (prescribed > 0 || unresolved > 0)
      days.push({
        date: record.date,
        prescribed,
        taken,
        missed: Math.max(0, prescribed - taken),
        unresolved,
      });
    doses.push(...entries.map((dose) => ({ ...dose, date: record.date })));
  }
  const prescribed = days.reduce((sum, day) => sum + day.prescribed, 0);
  const taken = days.reduce((sum, day) => sum + day.taken, 0);
  let longestMissedStreak = 0,
    streak = 0,
    previousDate;
  for (const day of days) {
    if (previousDate && daysBetween(previousDate, day.date) !== 1) streak = 0;
    streak = day.missed > 0 ? streak + 1 : 0;
    longestMissedStreak = Math.max(longestMissedStreak, streak);
    previousDate = day.date;
  }
  const timing = new Map();
  let lateDoses = 0, unresolvedTimingDoses = 0;
  for (const dose of doses) {
    const time = scheduledTime(dose);
    if (missedDose(dose) && time) {
      const timeLabel = /^\d{4}-/.test(time) ? time.slice(11, 16) : time;
      const found = timing.get(timeLabel) || {
        time: timeLabel,
        missedDoses: 0,
        dates: new Set(),
      };
      found.missedDoses++;
      found.dates.add(dose.date);
      timing.set(timeLabel, found);
    }
    // Clock-only schedules have no timezone. Do not reinterpret a local 08:00
    // schedule as UTC and turn an on-time Indian dose into a false late flag.
    const absoluteTime = value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
    const schedule = absoluteTime(dose.scheduledAt) ? dose.scheduledAt : null;
    if (takenDose(dose) && dose.takenAt && !schedule) unresolvedTimingDoses++;
    if (
      schedule &&
      takenDose(dose) &&
      absoluteTime(dose.takenAt) &&
      Date.parse(dose.takenAt) - Date.parse(schedule) > 120 * 60000
    )
      lateDoses++;
  }
  const overlap = [];
  const seen = new Map();
  for (const dose of doses) {
    const name = medicineName(dose),
      time = scheduledTime(dose);
    if (!name || !time) continue;
    const key = `${dose.date}|${name}|${time}`;
    if (seen.has(key) && !overlap.some((item) => item.key === key))
      overlap.push({
        key,
        date: dose.date,
        name,
        time,
        detail:
          "The same listed medicine name appears more than once at the same scheduled time. Verify whether these are duplicate entries with the pharmacist or care team.",
      });
    seen.set(key, true);
  }
  return {
    adherence: prescribed ? round((taken / prescribed) * 100) : null,
    prescribedDoses: prescribed,
    takenDoses: taken,
    missedDoses: prescribed - taken,
    missedDays: days.filter((day) => day.missed > 0).length,
    longestMissedStreak,
    observedDays: days.filter(day => day.prescribed > 0).length,
    unresolvedDoses: days.reduce((sum, day) => sum + day.unresolved, 0),
    scheduledDoses: days.reduce((sum, day) => sum + day.prescribed + day.unresolved, 0),
    invalidLogs,
    daily: days,
    timingPatterns: [...timing.values()]
      .map(({ dates, ...item }) => ({ ...item, days: dates.size }))
      .filter((item) => item.days >= 2),
    lateDoses,
    unresolvedTimingDoses,
    scheduleOverlaps: overlap.map(({ key, ...item }) => item),
    interactionCheck: {
      available: false,
      reason:
        "No drug-interaction database or clinical interaction model is included. Exact-name schedule duplicates are record-quality checks only.",
    },
    limitations:
      "Adherence uses resolved logged doses only. Pending, conflicting or unlogged doses remain unknown; missing logs do not prove a dose was missed. Timing patterns require explicit dose records. Do not change medicines from this analysis.",
  };
}

function languageFlags(notes) {
  const languages = [];
  const text = notes.join(" ");
  if (/[\u0900-\u097f]/u.test(text)) languages.push("Hindi");
  if (
    /\b(?:feeling|medicine|medicines|pain|sleep|family|appetite|fall|well|today|tired|confused|breathless)\b/iu.test(
      text,
    )
  )
    languages.push("English");
  if (
    /\b(?:dard|nahi|nahin|dawai|khana|bhookh|bhukh|neend|akela|thakaan|theek|gayi|gaya)\b/iu.test(
      text,
    )
  )
    languages.push("Hinglish");
  return languages;
}

/** Additional truthful reduced-sleep variants used by the Hindi IVR flow. */
export function extractAnalyticCues(text) { return extractCues(text); }

function domain(id, label, score, summary, evidence, action) {
  return {
    id,
    label,
    level: levelFor(score),
    score,
    summary,
    evidence: evidence.filter(Boolean),
    action,
  };
}

export function analyzeSenior(senior, records = [], { feedback = [] } = {}) {
  const asOfDate = dateFor(senior);
  const merged = mergeSeniorRecords(senior, records);
  const recent = merged.filter(
    (record) =>
      daysBetween(record.date, asOfDate) >= 0 &&
      daysBetween(record.date, asOfDate) < 7,
  );
  const rawRecent=observationRecords(records,{seniorId:senior?.id,asOfDate}).filter(record=>daysBetween(record.date,asOfDate)<7);
  const baselineRows = merged
    .filter((record) => record.date < addDays(asOfDate, -6))
    .slice(0, 30);
  const baseline = senior?.baseline || {};
  const measure = (key) =>
    average(recent.map((record) => record.vitals?.[key]));
  const latest = recent.at(-1);
  const latestVital = (key) =>
    [...recent].reverse().find((record) => isNumber(record.vitals?.[key]))
      ?.vitals[key] ?? null;
  const noteCues = new Map();
  for (const record of recent)
    for (const cue of extractAnalyticCues(record.note)) {
      const existing = noteCues.get(cue.cue) || {
        ...cue,
        dates: [],
        mentions: 0,
      };
      existing.dates.push(record.date);
      existing.mentions++;
      noteCues.set(cue.cue, existing);
    }
  const cues = [...noteCues.values()];
  const hasCue = (id) => noteCues.has(id);
  const cueEvidence = (ids) =>
    ids.flatMap((id) => {
      const cue = noteCues.get(id);
      return cue
        ? [
            `${cue.label}: ${cue.mentions} recent check-in${cue.mentions === 1 ? "" : "s"} (${cue.dates.join(", ")}).`,
          ]
        : [];
    });
  const medication = medicationAnalysis(recent);
  const domains = [];
  const systolic = measure("systolic"),
    diastolic = measure("diastolic");
  const sysDelta =
    isNumber(baseline.systolic) && systolic != null
      ? systolic - baseline.systolic
      : null;
  const diaDelta = isNumber(baseline.diastolic) && diastolic != null
    ? diastolic - baseline.diastolic
    : null;
  const pressureSevere =
    latestVital("systolic") >= 180 || latestVital("diastolic") >= 120 || rawRecent.some(record=>record.vitals?.systolic>=180||record.vitals?.diastolic>=120);
  const pressureScore = pressureSevere
    ? 90
    : sysDelta == null && diaDelta == null
      ? null
      : Math.abs(sysDelta || 0) > 20 || Math.abs(diaDelta || 0) > 12
        ? 60
        : Math.abs(sysDelta || 0) > 12 || Math.abs(diaDelta || 0) > 8
          ? 35
          : 5;
  domains.push(
    domain(
      "blood-pressure",
      "Blood pressure",
      pressureScore,
      pressureSevere
        ? "A logged reading needs prompt verification and clinical review."
        : sysDelta == null && diaDelta == null
          ? "Insufficient readings or personal reference."
          : Math.abs(sysDelta || 0) > 12 || Math.abs(diaDelta || 0) > 8
            ? "Blood pressure has moved away from the personal reference."
            : "Recorded readings are near the personal reference.",
      [
        systolic == null
          ? null
          : `Seven-day average ${round(systolic)}/${diastolic == null ? "—" : round(diastolic)} mmHg.`,
        latestVital("systolic") == null
          ? null
          : `Most recent logged systolic ${latestVital("systolic")} mmHg; most recent diastolic ${latestVital("diastolic") ?? "unavailable"} mmHg.`,
        isNumber(baseline.systolic)
          ? `Personal systolic reference ${baseline.systolic} mmHg.`
          : null,
        isNumber(baseline.diastolic)
          ? `Personal diastolic reference ${baseline.diastolic} mmHg.`
          : null,
      ],
      pressureSevere
        ? "Verify the reading and contact the clinical care team promptly."
        : "Review the trend during the next care check-in; do not change treatment from this flag.",
    ),
  );
  const glucose = measure("glucose"),
    latestGlucose = latestVital("glucose");
  const glucoseDelta =
    isNumber(baseline.glucose) && glucose != null
      ? glucose - baseline.glucose
      : null;
  const glucoseSevere =
    (latestGlucose != null && (latestGlucose < 70 || latestGlucose >= 300)) || rawRecent.some(record=>isNumber(record.vitals?.glucose)&&(record.vitals.glucose<70||record.vitals.glucose>=300));
  domains.push(
    domain(
      "glucose",
      "Glucose",
      glucoseSevere
        ? 90
        : glucoseDelta == null
          ? null
          : Math.abs(glucoseDelta) > 40
            ? 60
            : Math.abs(glucoseDelta) > 20
              ? 35
              : 5,
      glucoseSevere
        ? "A logged glucose reading needs human clinical review."
        : glucoseDelta == null
          ? "Insufficient glucose readings or personal reference."
          : Math.abs(glucoseDelta) > 20
            ? "Recent glucose differs from the personal reference."
            : "Recent glucose entries are near the personal reference.",
      [
        glucose == null ? null : `Seven-day average ${round(glucose)} mg/dL.`,
        latestGlucose == null
          ? null
          : `Most recent logged glucose ${latestGlucose} mg/dL.`,
        isNumber(baseline.glucose)
          ? `Personal reference ${baseline.glucose} mg/dL; meal timing is not inferred.`
          : null,
      ],
      glucoseSevere
        ? "Verify the reading and contact the clinical care team promptly."
        : "Confirm measurement context and review changes with the care team.",
    ),
  );
  const oxygen = measure("spo2"),
    lastOxygen = latestVital("spo2");
  const oxygenDrop =
    isNumber(baseline.spo2) && oxygen != null ? baseline.spo2 - oxygen : null;
  const oxygenSevere=(lastOxygen!=null&&lastOxygen<90)||rawRecent.some(record=>isNumber(record.vitals?.spo2)&&record.vitals.spo2<90);
  domains.push(
    domain(
      "oxygen",
      "Oxygen readings",
      oxygenSevere
        ? 90
        : oxygenDrop == null
          ? null
          : oxygenDrop > 3
            ? 60
            : oxygenDrop > 2
              ? 35
              : 5,
      oxygenSevere
        ? "A low logged oxygen reading needs prompt verification."
        : oxygenDrop == null
          ? "Insufficient oxygen readings or personal reference."
          : oxygenDrop > 2
            ? "Oxygen readings have fallen from the personal reference."
            : "Recorded oxygen values are near the personal reference.",
      [
        oxygen == null ? null : `Seven-day average SpO₂ ${round(oxygen)}%.`,
        lastOxygen == null ? null : `Most recent logged SpO₂ ${lastOxygen}%.`,
        isNumber(baseline.spo2)
          ? `Personal reference ${baseline.spo2}%.`
          : null,
      ],
      oxygenSevere
        ? "Check measurement quality and arrange prompt clinical review."
        : "Verify unusual measurements and review the person, not a device reading alone.",
    ),
  );
  const activity = average(recent.map(stepCount));
  const activityDrop =
    activity != null && isNumber(baseline.activity) && baseline.activity > 0
      ? 1 - activity / baseline.activity
      : null;
  domains.push(
    domain(
      "activity",
      "Movement & activity",
      activityDrop == null
        ? null
        : activityDrop > 0.35
          ? 65
          : activityDrop > 0.2
            ? 35
            : 5,
      activityDrop == null
        ? "Insufficient activity entries or personal reference."
        : activityDrop > 0.2
          ? "Daily movement is below the person’s usual routine."
          : "Logged movement is near the person’s usual routine.",
      [
        activity == null
          ? null
          : `Average ${Math.round(activity)} logged steps per day.`,
        activityDrop == null
          ? null
          : `${Math.round(Math.abs(activityDrop) * 100)}% ${activityDrop >= 0 ? "below" : "above"} the personal reference.`,
      ],
      "Ask about changes in routine, comfort and ability to move; agree a human follow-up.",
    ),
  );
  const sleep = average(recent.map(sleepHours));
  const sleepLoss =
    sleep != null && isNumber(baseline.sleep) ? baseline.sleep - sleep : null;
  domains.push(
    domain(
      "sleep",
      "Sleep & rest",
      sleepLoss == null
        ? null
        : sleepLoss > 1.5
          ? 60
          : sleepLoss > 0.8
            ? 35
            : 5,
      sleepLoss == null
        ? "Insufficient sleep entries or personal reference."
        : sleepLoss > 0.8
          ? "Sleep duration is below the usual pattern."
          : "Logged sleep duration is near the personal reference.",
      [
        sleep == null
          ? null
          : `Average ${round(sleep)} logged hours per night.`,
        isNumber(baseline.sleep)
          ? `Personal reference ${baseline.sleep} hours.`
          : null,
        ...cueEvidence(["poor_sleep"]),
      ],
      "Ask how rested the senior feels and review persistent changes with the care team.",
    ),
  );
  const moods = recent
    .map((record) => record.lifestyle?.mood)
    .filter((value) => value != null);
  const lowMoods = moods.filter((value) =>
    typeof value === "number"
      ? value <= 2
      : /^(?:low|sad|anxious|help|poor)$/i.test(String(value)),
  );
  const pains = recent
    .map((record) => record.lifestyle?.painScore)
    .filter(isNumber);
  const painScore = pains.length ? Math.max(...pains) : null;
  const moodObserved =
    moods.length ||
    pains.length ||
    ["confusion", "fatigue", "pain"].some(hasCue);
  const moodScore = hasCue("confusion")
    ? 75
    : painScore >= 7
      ? 65
      : lowMoods.length >= 2
        ? 60
        : lowMoods.length || hasCue("pain") || hasCue("fatigue")
          ? 35
          : moodObserved
            ? 5
            : null;
  domains.push(
    domain(
      "mood",
      "Mood & comfort",
      moodScore,
      moodScore == null
        ? "No explicit recent mood or comfort report."
        : hasCue("confusion")
          ? "A recent check-in mentions confusion; a person should verify the change."
          : moodScore >= 30
            ? "A check-in or self-report suggests a change in comfort or mood."
            : "Recent self-reports describe usual comfort.",
      [
        ...cueEvidence(["confusion", "pain", "fatigue"]),
        moods.length
          ? `${moods.length} explicit mood entr${moods.length === 1 ? "y" : "ies"}; ${lowMoods.length} describe low mood or a request for help.`
          : null,
        painScore == null
          ? null
          : `Highest submitted comfort/pain rating ${painScore}/10.`,
      ],
      hasCue("confusion")
        ? "Contact the senior promptly, clarify the report and arrange appropriate clinical review."
        : "Make a supportive call and ask what has changed; route concerns to the care team.",
    ),
  );
  const weight = measure("weight");
  const weightLoss =
    isNumber(baseline.weight) && weight != null
      ? baseline.weight - weight
      : null;
  const meals = average(recent.map((record) => record.lifestyle?.meals));
  const waterGlasses = average(
    recent.map((record) => record.lifestyle?.waterGlasses),
  );
  const hydrationReferences = baselineRows
    .map((record) => record.lifestyle?.waterGlasses)
    .filter(isNumber);
  const waterReference = isNumber(baseline.waterGlasses)
    ? baseline.waterGlasses
    : hydrationReferences.length >= 5
      ? average(hydrationReferences)
      : null;
  const waterDrop =
    waterGlasses != null && waterReference > 0
      ? 1 - waterGlasses / waterReference
      : null;
  const appetiteDays = noteCues.get("low_appetite")?.dates.length || 0;
  const nutritionObserved =
    weightLoss != null || meals != null || waterGlasses != null || appetiteDays;
  const nutritionScore =
    weightLoss > 2.2 || appetiteDays >= 2
      ? 65
      : appetiteDays || (meals != null && meals < 2) || waterDrop > 0.35
        ? 35
        : nutritionObserved
          ? 5
          : null;
  domains.push(
    domain(
      "nutrition",
      "Food & hydration",
      nutritionScore,
      nutritionScore == null
        ? "No usable recent food, hydration or weight entry."
        : nutritionScore >= 30
          ? "Food, weight or hydration entries deserve a check-in."
          : "Available intake and weight entries do not show a flagged change.",
      [
        ...cueEvidence(["low_appetite"]),
        weightLoss == null
          ? null
          : `Weight ${round(Math.abs(weightLoss))} kg ${weightLoss >= 0 ? "below" : "above"} the personal reference.`,
        meals == null
          ? null
          : `Average ${round(meals)} meals logged per day; incomplete entries are possible.`,
        waterGlasses == null
          ? null
          : `Average ${round(waterGlasses)} glasses logged; ${waterReference == null ? "no personal hydration reference is available" : `personal logged reference ${round(waterReference)}`}.`,
      ],
      "Ask about appetite and entry completeness. Review persistent changes and any individual fluid plan with the care team.",
    ),
  );
  const socialEntries = recent.filter(
    (record) =>
      record.lifestyle?.socialContact === true ||
      /\b(?:spoke with family|visiting family|met friends)\b|परिवार\s*(?:से|के\s*साथ)/iu.test(
        record.note || "",
      ),
  );
  const lonelyDays = noteCues.get("loneliness")?.dates.length || 0;
  domains.push(
    domain(
      "social",
      "Connection & company",
      lonelyDays >= 3 ? 60 : lonelyDays ? 35 : socialEntries.length ? 5 : null,
      lonelyDays
        ? "A recent check-in mentions feeling alone."
        : socialEntries.length
          ? "Recent entries mention contact with family or friends."
          : "No explicit recent social-contact information.",
      [
        ...cueEvidence(["loneliness"]),
        socialEntries.length
          ? `Social contact is mentioned on ${socialEntries.length} recent day${socialEntries.length === 1 ? "" : "s"}.`
          : null,
      ],
      "Offer a friendly call and ask which contact or activity the senior would welcome.",
    ),
  );
  const adherence = medication.adherence;
  domains.push(
    domain(
      "medication",
      "Medicine routine",
      adherence == null
        ? null
        : adherence < 60
          ? 75
          : adherence < 80
            ? 45
            : adherence < 95
              ? 30
              : 5,
      medication.invalidLogs
        ? "Medicine records contain inconsistent counts or conflicting outcomes; confirm the entries."
        : medication.unresolvedDoses
          ? "Some scheduled medicine outcomes remain unknown; confirm the dose log."
          : adherence == null
        ? "No complete recent medicine counts."
        : adherence < 95
          ? "Some logged doses were not recorded as taken."
          : "The logged medicine routine is consistent.",
      [
        adherence == null
          ? null
          : `${adherence}% of ${medication.prescribedDoses} resolved logged doses recorded as taken.`,
        medication.unresolvedDoses ? `${medication.unresolvedDoses} scheduled doses have an unresolved outcome and are excluded from adherence.` : null,
        medication.invalidLogs ? `${medication.invalidLogs} medicine log inconsistencies need record review.` : null,
        medication.observedDays
          ? `${medication.missedDays} days with a logged missed dose; longest consecutive recorded streak ${medication.longestMissedStreak} days.`
          : null,
        medication.scheduleOverlaps.length
          ? `${medication.scheduleOverlaps.length} exact-name schedule overlap${medication.scheduleOverlaps.length === 1 ? "" : "s"} need record review.`
          : null,
      ],
      "Confirm the dose record and barriers with the senior; arrange a pharmacist or care-team review without changing medicines.",
    ),
  );

  const lastCheckIn = merged.at(-1)?.date || senior?.lastCheckIn || null;
  const daysSinceCheckIn =
    lastCheckIn && validDate(lastCheckIn)
      ? Math.max(0, daysBetween(lastCheckIn, asOfDate))
      : null;
  const vitalExpected = recent.length * 5;
  const vitalObserved = recent.reduce(
    (sum, record) =>
      sum +
      ["systolic", "diastolic", "glucose", "spo2", "weight"].filter((key) =>
        isNumber(record.vitals?.[key]),
      ).length,
    0,
  );
  const flags = [];
  if (recent.length < 5)
    flags.push("Few recorded check-in days in the last week.");
  if (daysSinceCheckIn == null || daysSinceCheckIn >= 3)
    flags.push("Recent wellbeing is unconfirmed; arrange a human check-in.");
  if (vitalExpected && vitalObserved / vitalExpected < 0.7)
    flags.push("Several vital fields are missing.");
  if (!recent.some((record) => record.note))
    flags.push("No recent free-text check-in note.");
  if (medication.unresolvedDoses)
    flags.push("Some scheduled medicine outcomes remain unknown; confirm the dose log.");
  if (medication.invalidLogs)
    flags.push("Inconsistent medicine counts or conflicting dose outcomes need record review.");
  const dataQuality = {
    asOfDate,
    observedDays: recent.length,
    expectedDays: 7,
    coveragePercent: round((recent.length / 7) * 100),
    lastCheckIn,
    daysSinceCheckIn,
    vitalCompletenessPercent: vitalExpected
      ? round((vitalObserved / vitalExpected) * 100)
      : null,
    notesCount: recent.filter((record) => record.note).length,
    medicationObservedDays: medication.observedDays,
    level:
      !recent.length || (daysSinceCheckIn != null && daysSinceCheckIn >= 3)
        ? "high"
        : flags.length
          ? "medium"
          : "low",
    flags,
    interpretation:
      "Coverage describes recorded entries, not proof that an activity or dose did or did not occur. Missing domains remain unknown.",
  };
  const sensorRows = recent.filter(
    (record) => record.sensor && Object.keys(record.sensor).length,
  );
  const fallSignals = sensorRows.filter(
    (record) =>
      record.sensor.fallDetected === true ||
      (!(record.sensor.source === "browser-motion" && record.sensor.detectionEvaluated === true) && record.sensor.impactG >= 2.5 && record.sensor.postureChange === true),
  );
  const inactivityRows = sensorRows.filter((record) =>
    isNumber(record.sensor.inactiveMinutes),
  );
  const maxInactiveMinutes = inactivityRows.length
    ? Math.max(...inactivityRows.map((record) => record.sensor.inactiveMinutes))
    : null;
  const sensor = {
    fallSuspected: fallSignals.length > 0 || hasCue("fall"),
    fallEvidence: [
      ...fallSignals.map(
        (record) =>
          `${record.date}: ${record.sensor.fallDetected === true ? "a fall flag was submitted" : "submitted impact and posture-change fields crossed the illustrative review rule"}.`,
      ),
      ...cueEvidence(["fall"]),
    ],
    inactivity: {
      flagged: maxInactiveMinutes != null && maxInactiveMinutes >= 180,
      maxMinutes: maxInactiveMinutes,
      reviewThresholdMinutes: 180,
      observedDays: inactivityRows.length,
    },
    observedDays: sensorRows.length,
    source: sensorRows.length
      ? "Submitted sensor entries; no live device connection is implied."
      : "No sensor entries supplied; note-based fall cues are listed separately.",
    limitations:
      "Illustrative impact/posture and 180-minute inactivity rules route reports to a person. They are not validated fall detection; sleep, device non-wear and context can explain inactivity.",
  };
  const patterns = [];
  const addPattern = (id, title, detail, severity, source) =>
    patterns.push({ id, title, detail, severity, source });
  const repeatedCues = cues.filter((cue) => cue.dates.length >= 2);
  if (repeatedCues.length)
    addPattern(
      "persistent-cues",
      "Changes repeated across check-ins",
      repeatedCues
        .map((cue) => `${cue.label}: ${cue.dates.length} days`)
        .join("; "),
      repeatedCues.some((cue) => cue.severity >= 3) ? "high" : "medium",
      "notes",
    );
  if (medication.longestMissedStreak >= 2)
    addPattern(
      "missed-dose-streak",
      "Consecutive days with logged missed doses",
      `${medication.longestMissedStreak} consecutive recorded days include at least one missed dose. Confirm the log and ask about barriers.`,
      "medium",
      "medication",
    );
  if (medication.timingPatterns.length)
    addPattern(
      "missed-dose-timing",
      "A repeated medicine timing gap",
      medication.timingPatterns
        .map(
          (pattern) =>
            `${pattern.time}: missed entries on ${pattern.days} days`,
        )
        .join("; "),
      "medium",
      "medication",
    );
  if (medication.scheduleOverlaps.length)
    addPattern(
      "schedule-overlap",
      "Possible duplicate schedule entries",
      "Exact listed medicine names repeat at the same scheduled time. Ask a pharmacist to verify the records; this is not a drug-interaction check.",
      "medium",
      "medication",
    );
  if (daysSinceCheckIn == null || daysSinceCheckIn >= 3)
    addPattern(
      "missing-checkin",
      "A wellbeing check-in is needed",
      daysSinceCheckIn == null
        ? "No dated observation is available."
        : `The last dated entry is ${daysSinceCheckIn} days old. Missing records cannot establish wellbeing.`,
      "high",
      "data",
    );
  const changed = domains.filter((entry) => entry.score >= 30);
  if (changed.length >= 3)
    addPattern(
      "multiple-domains",
      "Several everyday signals changed together",
      changed.map((entry) => entry.label).join(", ") +
        ". A coordinator should review the combined picture.",
      changed.some((entry) => entry.level === "high") ? "high" : "medium",
      "personal-baseline",
    );
  if (appetiteDays && activityDrop > 0.2)
    addPattern(
      "intake-movement",
      "Eating and movement changed together",
      "Recent notes mention reduced appetite while recorded activity is below the personal reference. Ask what has changed and route concerns to the care team.",
      "medium",
      "combined",
    );
  if (sensor.fallSuspected)
    addPattern(
      "fall-review",
      "A possible fall needs human review",
      "A recent note or submitted sensor field reports a possible fall. Contact the senior to verify and arrange appropriate assessment.",
      "high",
      fallSignals.length ? "sensor" : "notes",
    );
  if (sensor.inactivity.flagged)
    addPattern(
      "inactivity-review",
      "A long inactive interval was submitted",
      `${maxInactiveMinutes} minutes were logged. Verify wake/sleep context, device wear and wellbeing; this is not proof of an incident.`,
      "medium",
      "sensor",
    );
  const nlp = {
    cues,
    languages: languageFlags(recent.map((record) => record.note || "")),
    notesAnalyzed: recent.filter((record) => record.note).length,
    method:
      "local Hindi / English / Hinglish lexicon with bounded negation handling",
    limitations:
      "Language tags are script and vocabulary hints, not a trained language identifier. Sarcasm, complex negation, transliteration variants and clinical context may be missed. Earlier positive reports remain visible when later notes deny a symptom; a person must resolve contradictory evidence.",
  };
  const summaryParts = [
    `The last seven days include ${recent.length} recorded check-in day${recent.length === 1 ? "" : "s"}.`,
  ];
  if (adherence != null)
    summaryParts.push(
      `Medicine logs record ${adherence}% of resolved logged doses as taken${medication.unresolvedDoses ? `; ${medication.unresolvedDoses} scheduled dose outcomes remain unknown` : ""}.`,
    );
  else if (medication.unresolvedDoses)
    summaryParts.push(`${medication.unresolvedDoses} scheduled medicine dose outcomes remain unknown.`);
  if (activityDrop != null && activityDrop > 0.2)
    summaryParts.push(
      `Logged movement is ${Math.round(activityDrop * 100)}% below the usual routine.`,
    );
  if (sleepLoss != null && sleepLoss > 0.8)
    summaryParts.push("Recorded sleep is below the usual pattern.");
  if (appetiteDays) summaryParts.push("A check-in mentions eating less.");
  if (lonelyDays)
    summaryParts.push("A friendly call or shared activity may be welcome.");
  if (sensor.fallSuspected || senior?.level === "high")
    summaryParts.push(
      "The care coordinator should review the changes promptly and agree the next step.",
    );
  else if (changed.length)
    summaryParts.push("A supportive coordinator check-in is recommended.");
  else
    summaryParts.push(
      "Continue the agreed check-in routine and confirm any missing entries.",
    );
  const summary = {
    text: summaryParts.join(" "),
    method: "local extractive",
    period: { from: addDays(asOfDate, -6), to: asOfDate, days: 7 },
    requiresHumanReview: true,
    externalServiceUsed: false,
  };
  const feedbackModel = trainFeedbackModel(feedback);
  return {
    ...classifyTriage(senior, [...recent,...rawRecent].filter(record=>daysBetween(record.date,asOfDate)<3)),
    domains,
    forecast: forecastRisk(senior?.trend, { asOfDate }),
    patterns,
    dataQuality,
    medication,
    nlp,
    summary,
    sensor,
    personalChanges: senior.changeDetection || null,
    baselineSupport: senior.baselineSupport || null,
    feedback: {
      ...feedbackModel,
      usefulAlertLikelihood: feedbackModel.predictUsefulAlert(senior),
      predictUsefulAlert: undefined,
      applySupplement: undefined,
    },
    modelCards: [
      {
        id: "risk",
        name: senior.model?.name || MODEL_INFO.name,
        method: MODEL_INFO.algorithm,
        inputs:
          "Recorded vitals, medicine counts, activity, sleep and local note cues relative to each person’s reference.",
        output: "Review priority, not a diagnosis or illness probability.",
        training: MODEL_INFO.training,
        status: senior.model?.status || 'unavailable',
        calibration: senior.model?.calibration || null,
        drivers: senior.model?.drivers || [],
        validation:
          "Held-out synthetic senior-days; see the model evaluation view.",
        limitations: MODEL_INFO.limitations,
        reference: MODEL_INFO.reference,
        externalServiceUsed: false,
      },
      {
        id: "notes",
        name: "Hindi / English / Hinglish cue extraction",
        method: nlp.method,
        inputs: "Recent check-in text.",
        output: "Named cues with dated evidence.",
        training: "Hand-authored rules; no model weights or API calls.",
        validation:
          "Repository tests cover supported cues and common negation forms; no population-level NLP accuracy is claimed.",
        limitations: nlp.limitations,
        externalServiceUsed: false,
      },
      {
        id: "forecast",
        name: "Three-day risk trend projection",
        method:
          "Ordinary least squares over recorded scores in the last 14 calendar days, with stale and sparse series rejected.",
        inputs:
          "At least five dated scores, at least 50% calendar coverage, no gap over three days, and a latest score no more than two days old.",
        output: "Projected score and descriptive residual envelope.",
        training: "Fits the displayed person’s observed score trend only.",
        validation:
          "Mathematical and missing-data tests; no future-event validation.",
        limitations:
          "No illness probabilities or calibrated clinical confidence; constant trends still receive a non-zero descriptive band.",
        externalServiceUsed: false,
      },
      {
        id: "summary",
        name: "Local weekly wellbeing summary",
        method: summary.method,
        inputs: "Aggregated seven-day entries and extracted routine changes.",
        output: "A short deterministic paragraph for human review.",
        training:
          "Template composition from measured aggregates; no generative model.",
        validation: "Tests verify content support and missing-data wording.",
        limitations:
          "A summary can omit context and requires coordinator review before family sharing. Consent is enforced by API routes.",
        externalServiceUsed: false,
      },
      {
        id: "sensor",
        name: "Submitted sensor review rules",
        method:
          "Explicit fall flag; or impact≥2.5g plus posture change; inactivity≥180 minutes.",
        inputs: "User-submitted sensor fields and recent fall mentions.",
        output: "A request for human verification.",
        training: "No trained fall model or device integration.",
        validation:
          "Rule tests only; no physical fall-detection accuracy is claimed.",
        limitations: sensor.limitations,
        externalServiceUsed: false,
      },
      {
        id: "feedback",
        name: "Useful-alert feedback supplement",
        method: "Local logistic regression with a held-out split.",
        inputs:
          "Coordinator useful/not-useful labels and numeric alert snapshots.",
        output:
          "Estimated useful-alert likelihood; never changes urgency or clinical scores.",
        training:
          "At least 20 labelled examples, at least five per class; identity-grouped holdout when identities are supplied.",
        validation: feedbackModel.trained
          ? `${feedbackModel.holdoutExamples} held-out examples; held-out accuracy ${feedbackModel.metrics.accuracy}.`
          : feedbackModel.reason,
        limitations:
          "Usefulness is a workflow judgement, not a health outcome. Small samples and biased feedback limit generalisation. No clinical probability is estimated.",
        externalServiceUsed: false,
      },
    ],
  };
}

/** A whitelist of derived values; never passes through notes or identifiers. */
export function redactForSummary(senior = {}) {
  const current = senior.current || {};
  const baseline = senior.baseline || {};
  return {
    priority: ["high", "medium", "low"].includes(senior.level)
      ? senior.level
      : "unknown",
    needsHumanReview: senior.level === "high" || senior.level === "medium",
    recordedMedicationAdherencePercent: isNumber(senior.adherence)
      ? senior.adherence
      : null,
    activityChangePercent:
      isNumber(current.activity) && baseline.activity > 0
        ? round((current.activity / baseline.activity - 1) * 100)
        : null,
    sleepChangeHours:
      isNumber(current.sleep) && isNumber(baseline.sleep)
        ? round(current.sleep - baseline.sleep)
        : null,
    weightChangeKg:
      isNumber(current.weight) && isNumber(baseline.weight)
        ? round(current.weight - baseline.weight)
        : null,
    dataCoveragePercent: isNumber(senior.confidence) ? senior.confidence : null,
    recordedRiskTrend: (senior.trend || [])
      .filter((point) => validDate(point.date) && isNumber(point.score))
      .slice(-7)
      .map((point) => ({ date: point.date, score: point.score })),
    reasonSources: [
      ...new Set(
        (senior.reasons || [])
          .map((reason) => reason.source)
          .filter((source) =>
            [
              "vitals",
              "medication",
              "notes",
              "activity",
              "model",
              "data",
              "baseline",
            ].includes(source),
          ),
      ),
    ],
    limitation:
      "Direct identifiers and free text are excluded. Derived health aggregates remain sensitive and must not be treated as anonymous.",
  };
}

const FEEDBACK_FEATURES = [
  "riskScore",
  "anomalyScore",
  "reasonCount",
  "dataConfidence",
];
const sigmoid = (value) => 1 / (1 + Math.exp(-clamp(value, -30, 30)));
function feedbackVector(example) {
  const source =
    example?.features || example?.snapshot || example?.senior || example;
  const score = source?.score ?? source?.riskScore;
  if (!isNumber(score)) return null;
  return [
    clamp(score / 100, 0, 1),
    clamp(isNumber(source.anomalyScore) ? source.anomalyScore : 0.5, 0, 1),
    clamp(
      (isNumber(source.reasonCount)
        ? source.reasonCount
        : Array.isArray(source.reasons)
          ? source.reasons.length
          : 0) / 5,
      0,
      1,
    ),
    clamp(
      (isNumber(source.confidence)
        ? source.confidence
        : isNumber(source.dataConfidence)
          ? source.dataConfidence
          : 50) / 100,
      0,
      1,
    ),
  ];
}
function hash(value) {
  let result = 2166136261;
  for (const char of String(value))
    result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

/** Estimate coordinator-perceived usefulness, never disease or urgent risk. */
export function trainFeedbackModel(examples = []) {
  const usable = examples.flatMap((example, index) => {
    const vector = feedbackVector(example);
    return typeof example?.useful === "boolean" && vector
      ? [
          {
            example,
            vector,
            label: Number(example.useful),
            group: String(
              example.seniorId ||
                example.senior?.id ||
                example.id ||
                `example-${index}`,
            ),
          },
        ]
      : [];
  });
  const positives = usable.filter((row) => row.label).length;
  const negatives = usable.length - positives;
  const identityGrouped =
    usable.length > 0 &&
    usable.every((row) => row.example.seniorId || row.example.senior?.id);
  const base = {
    method: "local logistic regression",
    target: "coordinator-rated useful-alert likelihood",
    featureNames: FEEDBACK_FEATURES,
    examples: usable.length,
    classCounts: { useful: positives, notUseful: negatives },
    identityGrouped,
    splitMethod: identityGrouped
      ? "Deterministic holdout by senior identity; no identity appears in both sets."
      : "Deterministic holdout by example; identity independence cannot be established.",
    limitations:
      "Workflow usefulness is not a clinical outcome or disease probability. Feedback can be biased and small holdouts are unstable. This supplement never lowers a risk score, removes an alert or changes an urgent action.",
  };
  const unavailable = (reason) => ({
    ...base,
    trained: false,
    status: "collecting feedback",
    reason,
    trainingExamples: 0,
    holdoutExamples: 0,
    metrics: null,
    predictUsefulAlert: () => null,
    applySupplement: (senior) => ({
      ...senior,
      usefulAlertLikelihood: null,
      feedbackSupplementAvailable: false,
    }),
  });
  if (usable.length < 20 || positives < 5 || negatives < 5)
    return unavailable(
      "Collect at least 20 numeric alert snapshots with at least five useful and five not-useful labels.",
    );
  const groups = [...new Set(usable.map((row) => row.group))].sort(
    (a, b) => hash(a) - hash(b) || a.localeCompare(b),
  );
  if (groups.length < 5)
    return unavailable(
      "At least five distinct senior identities or example groups are needed for a separate holdout.",
    );
  const holdoutGroups = new Set(groups.filter((_, index) => index % 5 === 0));
  const training = usable.filter((row) => !holdoutGroups.has(row.group));
  const holdout = usable.filter((row) => holdoutGroups.has(row.group));
  const trainPositive = training.filter((row) => row.label).length;
  if (
    training.length < 12 ||
    trainPositive < 3 ||
    training.length - trainPositive < 3 ||
    holdout.length < 4
  )
    return unavailable(
      "The identity-separated split needs at least 12 training examples, three per training class and four held-out examples.",
    );
  const weights = [0, 0, 0, 0];
  let intercept = Math.log(
    (trainPositive + 0.5) / (training.length - trainPositive + 0.5),
  );
  for (let iteration = 0; iteration < 600; iteration++) {
    const gradient = [0, 0, 0, 0];
    let interceptGradient = 0;
    for (const row of training) {
      const predicted = sigmoid(
        intercept +
          weights.reduce(
            (sum, weight, index) => sum + weight * row.vector[index],
            0,
          ),
      );
      const error = predicted - row.label;
      interceptGradient += error;
      for (let index = 0; index < weights.length; index++)
        gradient[index] += error * row.vector[index];
    }
    intercept -= (0.4 * interceptGradient) / training.length;
    for (let index = 0; index < weights.length; index++)
      weights[index] -=
        0.4 * (gradient[index] / training.length + 0.015 * weights[index]);
  }
  const probability = (vector) =>
    sigmoid(
      intercept +
        weights.reduce((sum, weight, index) => sum + weight * vector[index], 0),
    );
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    brier = 0;
  for (const row of holdout) {
    const predicted = probability(row.vector),
      positive = predicted >= 0.5;
    if (positive && row.label) tp++;
    else if (positive) fp++;
    else if (row.label) fn++;
    else tn++;
    brier += (predicted - row.label) ** 2;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const predictUsefulAlert = (example) => {
    const vector = feedbackVector(example);
    return vector ? round(probability(vector), 4) : null;
  };
  return {
    ...base,
    trained: true,
    status: "local supplement fitted",
    reason: null,
    trainingExamples: training.length,
    holdoutExamples: holdout.length,
    trainingGroups: groups.filter((group) => !holdoutGroups.has(group)),
    holdoutGroups: [...holdoutGroups],
    weights: weights.map((weight) => round(weight, 6)),
    intercept: round(intercept, 6),
    metrics: {
      accuracy: round((tp + tn) / holdout.length, 3),
      precision: round(precision, 3),
      recall: round(recall, 3),
      brierScore: round(brier / holdout.length, 3),
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
      threshold: 0.5,
    },
    predictUsefulAlert,
    applySupplement: (senior) => ({
      ...senior,
      usefulAlertLikelihood: predictUsefulAlert(senior),
      feedbackSupplementAvailable: true,
    }),
  };
}
