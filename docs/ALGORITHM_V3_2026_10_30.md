# Personal risk v3 - representative checks and reported concerns

This release supersedes v2 for the application. Scores still route wellbeing concerns to a human. They do not diagnose a condition or predict an emergency.

## Implemented changes

1. **Representative identity groups.** The reference-informed application now assigns 120 profiles to forest fitting, 30 to calibration and 50 to evaluation using profile-only strata: gender, age band and recorded diabetes history. Fixed seeded ID hashes rank within strata, with a standard hash finalizer to disperse sequential IDs. The default evaluation group contains 25 male and 25 female profiles, all three age bands and 16 diabetes-history profiles. Outcomes, symptoms, observation values and planted labels never choose these groups. Rare strata may lack a role when an integer allocation is impossible. Reordering the profile array does not change the plan or fitted results.
2. **Explicit historical comparison.** `legacy-modulo` preserves the preceding identity allocation for reproducible comparisons. `npm run evaluate:realistic` explicitly uses that historical allocation; `npm run evaluate:representative` evaluates both allocations with the current algorithms. Their different case mixes must not be interpreted as a model improvement.
3. **Concerns during reference collection.** Both cohort and newly registered senior paths now retain substantive note cues, existing absolute review readings and resolved missed doses during the first month. These yield a provisional human-review priority while personal references and anomaly scores remain unavailable. Routine notes or pending doses alone still return unknown. Existing immediate-review safeguards remain active. No later measurements enter an earlier reference-collection result.
4. **Additional natural language.** Hindi, English and Hinglish rules now recognize chest pressure/tightness, trouble catching breath, common Hindi fall forms, memory difficulty, appetite-loss wording and scheduled-dose omissions. Paired denials and other-person controls cover the new phrases; “Na dard hai na uljhan” and “भूख नहीं कम हुई है” do not become positive cues. `bilingual-assertions-v3` remains bounded lexical NLP, with regression examples rather than an independent clinical corpus.
5. **Consistent weekly reports.** Report facts now share the scoring module's medication-outcome calculation. Pending outcomes remain unknown and contradictory totals generate record-quality facts. Models cannot omit those uncertainty facts from a generated report. Same-day facts follow measurement/save chronology; unknown-time entries do not displace explicitly timed readings. A later device entry cannot erase an earlier reported possible fall. Personal identifiers and raw notes remain excluded from provider facts, and report text still requires coordinator review.
6. **Versioned serving.** Cache revisions include `personal-risk-v3` and the split strategy. The public health response exposes only the algorithm version alongside service metadata, allowing release checks without signing in or reading care records. The scheduled worker uses the same application module and version. Earlier historical snapshots retain their original meaning until recomputed.

## Measured synthetic results

The unchanged dataset has 200 synthetic profiles over 90 calendar days. The default cohort seed is 1042026, with 17,226 observations. Each evaluation allocation covers 3,000 senior-days after the 30-day personal-reference period. Model points, numerical review thresholds (30/60), robust variability floors and persistence thresholds have not been optimized against the selected cases.

| Default seed, same historical identity allocation | v2 snapshot | v3 |
|---|---:|---:|
| Authored case-days receiving review at >=30 | 46/80 (57.5%) | 51/80 (63.8%) |
| Cases receiving review | 4/4 | 4/4 |
| Mean delay after authored onset to review | 3.75 days | 3.25 days |
| Authored case-days receiving high priority at >=60 | 17/80 (21.3%) | 22/80 (27.5%) |
| Cases receiving high priority | 3/4 | 4/4 |
| High flags outside annotated intervals | 49 | 49 |
| All review flags per 100 evaluation senior-days | 3.233 | 3.633 |

This comparison reflects additional language understanding and refitting/calibration on the resulting note features. Review-day coverage increases, with higher potential coordinator workload. The high-priority mean detection delay changes from 5.67 days across three detected cases to 8 days across four detected cases; that average is not evidence of faster high-priority detection because the newly detected case is late. Annotations include recovery days and are not clinical outcome labels.

On the **new representative identity allocation**, the default seed gives 28/40 (70.0%) review-day coverage and 17/40 (42.5%) high-priority coverage. Both of its **two** authored cases receive review and high priority. Mean review delay is 4 days after authored onset, and mean high-priority delay is 4.5 days. Review workload is 2.667 flags per 100 evaluated senior-days; high-priority workload is 1.900. The two cases are multisignal and mobility scenarios: this allocation does not validate medication or appetite-case sensitivity.

The fixed representative allocation's three generator seeds yield review coverage 70.0%/75.0%/77.5% and high coverage 42.5%/45.0%/30.0%. These runs change generated observations but retain the same two case identities. They are correlated stress checks, not six independent patients or a newly collected blind test. The profile mix is more representative than the old allocation, but clinical accuracy and field false-alarm burden remain unknown.

See [the machine-readable results](evaluation/personal-risk-v3.json) for frozen split manifests, subgroup counts and flags, calibration, per-case delays, ablation, the earlier v2 checkpoint and source fingerprint. All observations and scenario IDs in these results are synthetic. Clinical precision, clinical recall, F1 and specificity remain null because days outside authored positive scenarios have no adjudicated outcomes.

## Reproduction and checks

```text
npm run evaluate:representative
npm run evaluate:realistic -- --metrics-only
npm test
npm run build:vercel
```

The behavior suite contains 426 tests. Focused checks cover profile-order invariance, outcome-label exclusion, no identity overlap, actual evaluation-case selection, first-month concern handling, bilingual assertion controls, unknown doses and chronological report facts. TypeScript and the local native production build pass (webpack is used locally because the dependency folder is an external junction). Algorithm-file linting has no errors and one existing unused-variable warning. Remote deployment uses its own installed dependency directory.

Identity grouping prevents the same senior contributing fitting and evaluation windows. Profile stratification addresses representation in the selected groups; it is not a statistical guarantee of representative performance. See [scikit-learn's official discussion of grouped and stratified evaluation](https://scikit-learn.org/stable/modules/cross_validation.html). No new dataset, pretrained NLP model, paid provider, SMS delivery or autonomous call acceptance is established by this release.
