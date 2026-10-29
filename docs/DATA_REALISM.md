# Data provenance and realistic-scenario checks

The website's reports must describe the observations that exist, with dates,
units, coverage and limitations. An LLM must not invent readings, interventions,
calls, family contact, diagnoses or model confidence. A plausible simulation is
still a simulation. It must never be presented as a real patient's history.

## Two distinct datasets

The original `generateCohort()` is retained as the legacy, deliberately strong
stress-test benchmark. Its 93.7% precision / 74.2% recall only apply to that
authored cohort and threshold. They do not transfer to a different cohort.

`generateRealisticCohort()` in `lib/realistic-cohort.mjs` creates a separate
reference-informed synthetic mode. It preserves the 200 seniors and 90-day
window, but changes the observation process:

- Within-person blood-pressure, glucose, movement and sleep changes have serial
  correlation rather than being independent daily draws.
- Medication-taking logs can be missing. Missing does not mean doses were missed.
  Individual scheduled-dose statuses sum to the daily count, and missed doses
  can occur at different times rather than always being assigned to the last dose.
- Note content agrees with the current medication log. A new fall is a single
  dated, unconfirmed incident; later reduced activity or pain is a separate
  observation rather than a newly invented fall every day.
- Weights move gradually, including recovery. Observation schedules differ by
  modality. Glucose timing is explicitly unspecified rather than being silently
  treated as fasting.
- Every profile and record carries its synthetic origin and generator version.
  Names, locations, symptoms, taking a medicine, sleep, steps and sensor fields
  remain newly authored fictional data.

The default scenario fraction is 8% of identities for this stress-test mix. It is
**not** an estimate of decline prevalence. Its four pattern families are changes
across multiple signals, medication routine, appetite/social contact, and mobility.
Scenario labels include persistent changes through gradual recovery; the separate
`declineEndDate` records when the authored deterioration stops. A synthetic
escalation deadline is an authored review deadline, not an observed acute event.

## External aggregate reference

The official [MITRE Synthea downloads page](https://synthetichealth.github.io/downloads.html)
provides a freely reusable synthetic sample. Synthea models are informed by
clinical knowledge and population statistics, but the sample remains synthetic.
The source and method are described by [Walonoski et al., JAMIA 2018](https://doi.org/10.1093/jamia/ocx079).

`scripts/build-reference-calibration.py` downloads the bounded April 2020 CSV
archive from MITRE's sample-data mirror into ignored `outputs/reference/`. It
keeps only aggregate distributions at observation age 60-110, first taking one
median per synthetic identity. The committed file contains no patient identities
or observation rows. The exact archive SHA-256 is
`4194b18c11eaedcf0d5d5dd448d8ac9661f14381e2ef9f109215dc42266cd38a`.

| Modality | Synthetic reference identities | Compatible observations | P10 / median / P90 of identity medians |
| --- | ---: | ---: | --- |
| Systolic BP, mmHg | 296 | 3,558 | 113.75 / 119.5 / 127.0 |
| Diastolic BP, mmHg | 296 | 3,558 | 76.0 / 80.0 / 83.0 |
| Glucose, mg/dL | 220 | 3,419 | 74.75 / 82.03 / 92.51 |
| Weight, kg | 296 | 3,243 | 71.35 / 82.47 / 95.70 |
| SpO2 | Not available | None with the supported code/unit | Disclosed illustrative assumption |

The generator uses these aggregate distributions as reference context for its
starting values. History subgroups, age offsets, observation variability,
autocorrelation, symptoms and decline progression are explicit authored
assumptions. This US sample does not establish the distribution of Indian older
adults. Medication orders in an EHR do not establish that somebody took a dose.

The [PhysioNet Autonomic Aging dataset](https://physionet.org/content/autonomic-aging-cardiovascular/1.0.0/)
was also assessed. It has real resting ECG and continuous non-invasive BP from
healthy volunteers with grouped ages. It does not contain the required 90-day
home-care notes, medication-taking and decline outcomes. Importing unrelated ICU,
laboratory or resting waveforms and claiming senior-home risk accuracy would be
misleading; no such clinical validation is claimed here.

## Evaluation is deliberately honest

Use `createRealisticEngine()` with this mode. It calls the unchanged personal-rule
and Isolation Forest implementation and returns partial-label metrics. The known
positive review windows are authored; all other days are **unlabelled**, not
confirmed healthy. Incidental low glucose measurements remain visible and may
correctly trigger a check-in outside an annotated scenario. Such flags are
reported as `unlabelledHighSeniorDays`, not automatically called false alarms.

Therefore clinical precision, specificity, recall and F1 are not estimable.
Public `precision` and `f1` are null. `recall` is explicitly labelled high-flag
coverage within authored scenario days; case coverage and onset delay are also
limited to those scenarios. The legacy 93.7% figure must not be substituted.

For seed 1042026, the separate cohort has **17,226 observations**, **16 authored
scenario identities** and **four single reported fall incidents**. It passes all
structural/consistency checks. At the unchanged threshold, three of four
identity-held-out scenarios are detected; high-priority coverage is **20.0% of
authored scenario days**, mean first detection **6.0 days after onset**, with
**49 unlabelled high-priority senior-days**. These figures expose limitations of
the original scoring thresholds rather than masking them with fabricated accuracy.

The product also has medium-priority, same-day check-ins. The separately reported
`scenarioReviewCoverage` measures the existing threshold of 30, without retuning:
**60.0% of authored scenario days** receive medium or high priority; **four of four**
held-out scenarios receive a review flag, averaging **3.75 days after onset**.
This is distinct from high-priority coverage and still does not estimate clinical
precision or predict a diagnosis. Evaluation annotations and recovery phase are
kept out of clinical observation records and are not report-generation inputs.

Three seeds produce 20.0%-31.3% scenario-day coverage, three to four detected
scenarios out of four, and 49-62 unlabelled high days. This is still a small
authored stress set, not an independent clinical trial or representative dataset.
No thresholds are adjusted using these held-out results. More suitable labelled
data and human adjudication are required before claiming real-world accuracy.

## Reproduce and inspect

```powershell
node --test tests/realistic-data.test.mjs
node scripts/evaluate-realistic.mjs
# Optional: rebuild the source aggregate; Python standard library only.
python scripts/build-reference-calibration.py
```

The evaluation script writes `outputs/realistic-evaluation.json`, the daily
JSONL observations, profiles and scenario annotations. `--metrics-only` omits
the row-level exports. Nothing is uploaded. `lib/data-quality.mjs` checks dates,
duplicates, patient scope, numeric plausibility, pressure order, medication counts,
dose consistency, contradictory notes, abrupt weight changes, modality missingness
and within-person temporal correlation. These checks find inconsistent data; they
do not establish medical validity. Broad plausibility bounds are not diagnostic
reference ranges.
