# Local analytics and alert workflow

Samarth Care performs these functions locally with JavaScript and the existing application database. They require no language-model API, paid model, hosted inference endpoint, or external patient dataset. The showcase uses fictional records. Hosted deployment and provider quotas are separate from the model implementation; running the source locally does not require a paid inference service.

## Modules and entry points

`lib/analytics.mjs` exports:

```js
analyzeSenior(scoredSenior, records, { feedback: [] })
mergeSeniorRecords(scoredSenior, records)
forecastRisk(trend, { asOfDate })
extractAnalyticCues(note)
redactForSummary(scoredSenior)
trainFeedbackModel(labelledSnapshots)
```

The scored senior is the existing risk-engine result. Records can include the full cohort: the module selects the requested identity, rejects invalid calendar dates, and excludes observations after the analysis date. It merges partial entries by senior and date. Vitals, medicine, lifestyle and sensor objects retain independent fields; submitted notes remain chronological evidence. A later negative statement does not silently erase an earlier serious positive report. A coordinator must resolve contradictory evidence.

The recent analysis window is seven calendar days. The existing engine supplies each senior's initial 30-day personal baseline. The supplementary hydration reference requires an explicit baseline or at least five older hydration entries; the module does not invent a drinking target.

`lib/triage.mjs` owns the shared `extractCues`, `classifyTriage` and `compareTriage` functions. The engine re-exports cue extraction and classification for compatibility. Scores, detailed analytics and queue ordering consume the same urgency contract:

| Urgency | Rank | Meaning |
| --- | --- | --- |
| `immediate` | 0 | A submitted serious reading, fall/symptom report, sensor review flag or explicit help request needs prompt human contact. |
| `today` | 1 | Recorded changes warrant a care-team check-in today. |
| `unknown` | 2 | Insufficient observations or an incomplete baseline prevent an established priority. |
| `routine` | 3 | Enough recent observations support the agreed routine check-ins. |

`rankSeniors` sorts urgency first and score second. A serious new reading cannot sit below a non-immediate score of 100. An `unknown` senior has `score: null` and `level: unknown`; this is distinct from zero risk. The minimum recent support is six of 27 expected signal fields across at least two signal groups. Incomplete recording confidence is reported as completeness, never clinical certainty. Observed concerns remain visible even when other fields are missing.

The first 30 calendar days are an explicit baseline warm-up. Historical requests in that window expose no fitted reference or anomaly score from later observations. Absolute reported serious signals still route to immediate human review. After warm-up, the first30-day reference stays fixed; subsequent dates advance check-in age using `asOfDate`, including dates beyond the original cohort end. Blood-pressure and glucose changes are reviewed in both directions; unusually increased sleep or activity entries also request context verification. These are illustrative review rules, not treatment instructions.

## Inputs beyond the original signals

```js
{
  seniorId: 'S001', date: '2026-10-27',
  lifestyle: {
    steps: 1800, sleepHours: 6, waterGlasses: 4,
    meals: 2, mood: 'low', painScore: 3, socialContact: true
  },
  sensor: {
    steps: 1800, inactiveMinutes: 120,
    fallDetected: false, impactG: 1.2, postureChange: false
  },
  medication: {
    taken: 2, prescribed: 3,
    doses: [{ name: 'Example tablet', scheduledTime: '08:00', status: 'missed' }]
  }
}
```

Sensor steps take precedence over lifestyle steps, which take precedence over the legacy activity field. Lifestyle sleep hours take precedence over the legacy sleep field. Explicit dose entries support `name`/`medicine`, `scheduledTime`/`time`, `scheduledAt`, `takenAt`, and taken/missed status. Merely scheduled, unresolved doses are not assumed missed. Ingestion routes validate submitted values separately.

## Analysis output

`domains` contains blood pressure, glucose, oxygen, activity, sleep, mood/comfort, food/hydration, social connection and medicine routine. Each entry has `id`, `label`, `level`, `score`, `summary`, `evidence` and `action`. Levels are `high`, `medium`, `low` or `unknown`. An unknown domain has a null score; missing logs do not establish a normal routine. The domain scores supplement the original ranked risk score and do not replace it.

`dataQuality` reports observed and expected days, coverage, vital completeness, note count, medicine-log coverage and check-in age. These measure recording completeness, not verified wellbeing. `medication.adherence` is a percentage from logged taken/scheduled counts. Missed-day streaks stop across unobserved days. Repeated dose-time gaps are reported only when explicit dose times exist. Exact medicine names repeated at the same scheduled time trigger record verification. No drug-interaction database is included, and no interaction or medicine-change advice is inferred.

`nlp` contains shared local cues, dated evidence and language hints. Both core scoring and analytics use the same English/Hindi/Hinglish lexicon and bounded negation/subject checks, including `नींद कम आई`, `neend kam` and `yaad nahi aa raha`. `extractAnalyticCues` delegates directly to the shared extractor. Explicit daughter/son/spouse/friend subjects are excluded unless the sentence switches back to the senior; reports about a mother or father remain eligible as common family-report wording. This is limited subject attribution and must be confirmed with the reporter. Script/vocabulary tags are not a trained language identifier. Sarcasm, unusual transliteration and complex context remain limitations.

`patterns` identifies repeated cues, consecutive logged missed-dose days, recurring dose-time gaps, duplicate schedules, missing check-ins, combined domain changes, appetite/activity changes, reported falls and submitted inactive intervals.

`sensor` reports submitted flags and note evidence. A submitted fall flag, or submitted impact of at least 2.5g together with posture change, requests human review. An inactive interval of 180 minutes also requests context verification. These are illustrative rules, not a validated fall detector or a live wearable connection. Sleep and device non-wear can explain inactivity.

`summary` is a deterministic, locally composed paragraph using supported seven-day aggregates. Its method is `local extractive`; it is not LLM-generated. A human should review it before family sharing. `redactForSummary` returns a whitelist of derived aggregates, omitting identity, contact details and raw notes. Those aggregates remain sensitive and are not anonymous.

`modelCards` explains the risk engine, local note extraction, trend projection, summary composition, submitted sensor rules and feedback supplement, including inputs, outputs, validation and limitations.

## Three-day trend projection

`forecast` fits ordinary least squares to up to 14 observed dated risk scores. At least five observations spanning five calendar days are required. Calendar gaps affect the regression. Insufficient support produces no projected points and a null slope.

The output includes three future `date`/`score` points with `lower`/`upper` descriptive envelopes, slope per day, observed support and residual standard deviation. The envelope uses regression residuals, extrapolation distance and a minimum width even for a perfect line. Scores remain within 0–100. This projection is not an illness forecast, event probability or calibrated medical confidence interval. It is not used to lower a current alert.

## Reproducible synthetic evaluation

`generateCohort({seed, endDate, seniorCount, days, languageVariant})` accepts deterministic configuration. The default remains 200 seniors and 90 calendar days, with 17,645 recorded observations and 40 planted decline intervals. The generator records onset, end and an escalation deadline. `criticalDate` remains a compatibility alias for `escalationDate`; no acute event is generated at that deadline.

`metrics()` evaluates days31 onward on every fourth identity, held out from forest fitting. Daily precision/recall differ from episode detection. Unknown days remain in the denominators as unflagged, so abstention cannot inflate reported recall. `meanLeadDays` means days **before the planted escalation deadline**, while `meanOnsetDetectionDelayDays` explicitly measures days **after planted onset**. Per-pattern rates describe the identities with each planted pattern, not all negative seniors. The same synthetic records, split, thresholds and NLP feed the rules-only ablation; only the anomaly contribution is disabled.

Current default results are daily precision 93.7%, recall 74.2%, F1 82.8%, 10/10 planted held-out intervals detected, mean escalation lead 4.7 days and mean detection delay after onset 3.1 days. The rules-only ablation gives precision 92.8%, recall 64.2%, F1 75.9%, escalation lead 3.5 days and onset delay 4.3 days. These measurements are demonstration results, not independent clinical accuracy.

`evaluateRobustness()` repeats evaluation over three deterministic seeds and two phrase variants. Six current full-size runs give precision 92.2–93.9% and recall 73.3–79.2%. Eight transparent language/attribution probes pass. Alternative phrases, generator patterns and rules are authored in this repository: these probes are not a sequestered blind NLP benchmark or independent patient dataset. Correlated senior-days also make these ranges unsuitable as clinical confidence intervals.

Run `npm run evaluate` to export aggregate metrics, per-pattern results, ablation and robustness runs in `outputs/evaluation.json`, synthetic records in `synthetic-cohort.jsonl`, profiles in `synthetic-seniors.json` and evaluation-only labels in `ground-truth.json`. `--metrics-only` avoids writing the record/label exports. These output files are ignored by Git. No API call or real health record is used by evaluation.

## Coordinator feedback model

Usefulness examples have `useful: boolean` and a numeric alert snapshot, either at the top level or under `features`, `snapshot` or `senior`. Supported features are score, anomaly score, reason count and recording confidence. At least 20 labelled examples, with at least five in each class, are required. Sparse or unbalanced feedback produces an explicit collecting-feedback state.

The implementation fits a regularised logistic classifier with deterministic gradient descent. It reserves approximately one fifth of distinct groups for evaluation. When senior identities are supplied, an identity never appears in both training and holdout sets. A valid split also needs at least 12 training examples, three per training class and four held-out examples. Without identities, the output explicitly states that identity independence cannot be established.

Held-out accuracy, precision, recall, Brier score and confusion counts are reported. Undefined class metrics remain null. The target is **coordinator-rated alert usefulness**, not illness or clinical outcome. `predictUsefulAlert(snapshot)` supplies a workflow supplement; `applySupplement(senior)` preserves the original score, urgency and action. Held-out labels never affect fitted weights. Biased feedback and small holdouts limit generalisation.

## Routes and alert state

`lib/analysis-routes.mjs` receives the authenticated access context from the main API. It handles:

- `GET /api/analysis/:id`: detailed analytics for care staff within assigned scope.
- `GET /api/summaries/:id`: staff summaries, or the linked senior/family summary; family consent is checked on each request.
- `GET /api/alerts`: ranked daily alerts, policy and status counts. Families receive linked high-priority notices without raw clinical reasons or scores. Seniors receive a gentle linked check-in prompt.
- `PATCH /api/alerts/:id`: coordinator acknowledgment, reopening, 1–24-hour snooze or resolution. Resolution requires an outcome. Urgent reports cannot be snoozed.
- `GET /api/feedback/model`: staff-scoped feedback-model metadata.
- `GET /api/alerts/policy` and owner-admin `POST`: minimum score 30–60 and cooldown 1–72 hours.

Alerts have stable daily IDs such as `A-S001-2026-10-27`. State is stored as `alert_state` events. A new urgent signal changes the evidence fingerprint and reopens an older resolved or snoozed alert. High scores and urgent readings, fall/symptom reports or help requests bypass policy filtering. Prior-day acknowledgment/resolution can quiet a nonurgent repeat below score 60 during the configured cooldown; quieted entries remain inspectable in `suppressed`. It cannot suppress a fresh high or urgent report. Family consent and care scope also apply to these routes.

Run the focused checks with:

```text
node --test tests/engine.test.mjs tests/analytics.test.mjs tests/triage.test.mjs tests/analysis-routes.test.mjs
```

The tests exercise missing support, same-day overlays, multilingual cues and negation, descriptive projections, explicit dose patterns, sensor limitations, summary redaction, holdout leakage, urgency preservation, scope, consent, lifecycle persistence, cooldown and future-observation exclusion. They establish implementation behavior, not clinical effectiveness.
