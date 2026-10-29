# Personal risk algorithms - 30 October 2026

This release is `personal-risk-v2`. It supersedes earlier scoring and evaluation descriptions. The product remains a human review and follow-up system. Its scores are not diagnoses, illness probabilities, or clinically validated predictions.

## What changed

- **Measured personal references:** daily entries are merged before reference fitting, so repeated records cannot overweight a date. Each field uses its own measured median and median absolute deviation, with documented variability floors and minimum observation counts. Missing references remain null; generated profile values are never substituted.
- **Separated anomaly calibration:** the Isolation Forest still has 48 trees, nine features and a maximum 128 observations per tree. Of 150 development identities, 120 fit the forest and 30 provide separate baseline calibration. The existing 50 evaluation identities remain excluded from both. Stable identity hashing selects the calibration group. The illustrative anomaly cutoff is the 97.5th percentile of 411 calibration windows, rather than a fixed raw score. Sparse inputs or insufficient fitting/calibration support cause model abstention. Anomaly points remain capped at 22.
- **Sustained personal changes:** a seven-calendar-day EWMA highlights repeated moderate shifts relative to measured personal variability. It needs at least four observed days, a recent measurement, at least three same-direction deviations, and corroboration across vital readings and daily routines before adding up to 18 points. Systolic and diastolic changes alone cannot count as independent domains. Gaps decay evidence. This is a descriptive rule; correlated observations prevent interpreting its threshold as a medical confidence level.
- **Inspectable reasons:** coordinators see dated persistent changes, the reference comparison and observed-day support. For positive forest contributions, the model reports which feature replacements most reduce its score. These sensitivities are not causal explanations.
- **Medication uncertainty:** one shared calculation serves scoring and analysis. Explicit pending, unlogged and conflicting dose outcomes are not converted to missed doses, including when daily totals are present. Invalid totals need record review. Dose lateness requires timestamps with timezones. No drug-interaction model or treatment recommendation is claimed.
- **Hindi, English and Hinglish assertions:** versioned lexical rules distinguish symptoms from denials, intrinsic negative phrases such as “no appetite”, other people's symptoms, remote history, resolved reports, questions and hypothetical advice. Current symptoms remain visible when a sentence also mentions older history. Recent uncertain falls still request verification. This is bounded rule-based NLP, not general clinical language understanding.
- **Current versus old evidence:** prompt triage uses the current three-calendar-day evidence window. An old severe reading no longer remains an immediate flag indefinitely; missing current information requests a fresh check-in. Impossible dates and future submissions cannot affect the current score. Earlier serious same-day raw readings remain visible even after a later normal reading.
- **Forecast restraint:** projections require a recent, sufficiently covered calendar window and stop on stale or disconnected histories. Their dates start after the analysis date. They describe recorded score trends, not future disease.
- **Motion quality:** missing sensor time no longer counts as observed quiet. A fall candidate requires a pre-impact orientation and sustained observed quiet after impact; evaluated rejected browser candidates cannot trigger the older impact shortcut. Foreground phone motion remains unvalidated evidence about a device, not proof that a person fell.
- **New senior records:** after 30 elapsed calendar days and sufficient measured observations, submitted records can establish their own personal reference and use rules and repeated-change detection. They never inherit synthetic histories or a synthetic fitted forest. Without independent calibration data, their anomaly model remains unavailable.
- **Versioned persistence:** current score-cache revisions include the algorithm version. Newly recomputed historical scores carry the version in both the record and history revision. Previously stored historical snapshots remain historical results and are not retroactively relabelled.

## Reproducible comparison

The unchanged reference-informed benchmark has 200 synthetic seniors, 90 calendar days and 17,226 observed senior-days. Fifty identities provide 3,000 evaluation days, including four authored review scenarios and 80 positive annotated days. Other days are unlabelled. Neither their flags nor their absence establish false alarms or true negatives.

| Default seed measure | Earlier checkpoint | This release |
|---|---:|---:|
| Scenarios receiving review at score >=30 | 4/4 | 4/4 |
| Scenario-day review coverage | 48/80 (60.0%) | 46/80 (57.5%) |
| Mean delay from authored onset to review | 3.75 days | 3.75 days |
| Scenarios receiving high priority at score >=60 | 3/4 | 3/4 |
| Scenario-day high coverage | 16/80 (20.0%) | 17/80 (21.3%) |
| Mean delay from authored onset to high priority | 6.0 days | 5.67 days |
| High flags outside scenario annotations | 49 | 49 |
| High flags per 100 evaluated senior-days | 2.167 | 2.200 |

These results are mixed: the high-priority detector catches one more annotated day, while overall review-day coverage falls by two days. The release is not a demonstrated improvement in every accuracy measure. Numeric priority thresholds were kept at 30 and 60. No thresholds were selected by searching these four held-out cases.

Across seeds 1042026/1042027/1042028, high scenario-day coverage changes from 20.0%/30.0%/31.3% to 21.3%/33.8%/36.3%. Rules alone cover 13.8% of the default seed's high-priority scenario-days and two cases; rules plus forest cover 21.3% and three cases. These are authored synthetic stress checks, not independent clinical evidence.

The existing evaluation split has a serious limitation: all 50 held-out profiles are male because the original modulo split correlates with profile construction. These results cannot establish generalisation across genders. A later evaluation should freeze an independently assigned, representative identity split and compare both old and new models on it. Clinical precision, clinical recall, specificity and F1 remain unestablished. The model also has no validated forecast of an actual emergency; “lead time” is relative to an authored review deadline.

See the [machine-readable report](evaluation/personal-risk-v2.json) for exact calibration, cases, subgroup coverage, burden, ablation, provenance and source fingerprint. Reproduce the current report with:

```text
npm run evaluate:realistic -- --metrics-only
npm run evaluate:upgrade
npm test
```

To compare against an earlier saved aggregate report, run `npm run evaluate:upgrade -- --baseline PATH_TO_PRIOR_REPORT.json`. An absent earlier report leaves the before-values absent. The evaluator rejects incompatible cohort metadata and stale cached metrics rather than inventing a comparison. Generated output stays in the ignored `outputs/` directory.

## Sources and remaining evidence needs

The in-repository forest implements the [original Isolation Forest method](https://doi.org/10.1109/ICDM.2008.17). [Scikit-learn's official documentation](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html) describes the distinction between raw anomaly scores and a chosen decision threshold; scikit-learn is a methodological reference, not a runtime dependency. Robust scaling follows the [NIST discussion of median absolute deviation](https://www.itl.nist.gov/div898/handbook/eda/section3/eda356.htm). The repeated-change detector draws on [NIST's EWMA description](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm), with explicit support/corroboration gates rather than a claim of calibrated process-control limits.

Synthetic data provenance and its Synthea reference remain in [DATA_REALISM.md](DATA_REALISM.md). Independent clinician-adjudicated outcomes, a representative identity split, Hindi/English language evaluation, device validation and measured coordinator burden remain necessary before real-world accuracy or safety claims. LLM report rendering, carrier calls and SMS transport are separate components; this release does not establish new provider acceptance or autonomous calling capability.

## Implementation checks

The release passes 411 automated behavior checks, TypeScript checking and a local native Next.js production build with webpack. The local dependency folder is a junction to the development checkout; Turbopack rejected that external junction, so webpack was used for the local build. Deployment installs dependencies into its own project directory. Targeted algorithm-file linting reports no errors; the existing large care extension component retains earlier lint findings. These engineering checks do not establish clinical accuracy or new carrier/provider delivery.
