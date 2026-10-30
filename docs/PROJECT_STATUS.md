# Current showcase status

Snapshot: 31 October 2026. Consolidates development through `f04a6a3`, with repository presentation improvements. Historical release documents preserve the state at their recorded date; this page is the current feature-status entry point.

## Established prototype capabilities

- Four account types with Operations as the administrative role, scoped care access, invitations, account/contact editing and family consent.
- Vitals, medication logs and bilingual notes; personal comparisons, a rules/anomaly score, dated reasons and a human next step.
- Protected follow-up records, care conversations and day/week/month monitoring.
- Registered-senior HELP SMS intake with saved cloud requests and actual coordinator/family SMS delivery receipts. Live use still requires the Android gateway and receiver online.
- A published n8n workflow that has generated an actual `gpt-5-mini-2025-08-07` report draft. Staff can inspect evidence, review/reject, select linked family recipients, share, withdraw and archive saved versions. No automatic approval.
- Medication outcome and recurring timing charts. Unlogged, pending and conflicting entries remain unknown.

## Explicit limitations

| Area | Boundary |
|---|---|
| AI Call Bot | Under development. Prepared guided bilingual code and automation controls have not completed physical end-to-end app-call acceptance. Work is deferred for the showcase. |
| Voice accessibility | The PS's voice/simple-call requirement is not fully met. SMS helps seniors who can send a text; it does not solve every hearing, vision or literacy barrier. |
| Two-way SMS check-ins | Implemented in code and tests; physical question plus correctly matched reply remains unaccepted. This is separate from verified HELP intake. |
| SMS learned classifier | Shadow mode after failed release gates. Model-only automatic routing is disabled. Rules and explicit commands remain separate active routes. |
| Weekly reporting | Explicit staff requests and review; no cohort-wide automatic weekly inference or auto-sharing schedule. |
| Medication interactions | Not implemented. No dose-change or treatment recommendation. |
| Motion | Experimental device evidence and unconfirmed candidates; no validated continuous fall/wearable monitoring. |
| Feedback | Collection and experimental usefulness code do not establish an improving deployed model. |
| Real-care use | No clinical validation, security certification, emergency dispatch integration or guaranteed human response. |
| Scale and cost | No measured 10,000-senior throughput or production cost. Hackathon allowances are finite. |

## Evidence that must remain separate

1. Automated engineering checks establish expected code behaviour.
2. Hosted rollback fixtures check real database guards in a controlled transaction.
3. Synthetic evaluations describe authored scenarios, not clinical performance.
4. Device receipts establish transport evidence, not that a person read or acted.
5. A completed model draft is separate from human review and family publication.

The consolidated source passes 516 Node behaviour checks. Reproduce with `npm test`; use the CI result for the published commit. Do not quote a historical test count as medical accuracy.

## Model results

Personal risk v3 uses 120 fitting, 30 calibration and 50 evaluation identities. The representative default seed contains two authored cases and 40 labelled days: 28 review-priority days (70%) and 17 high-priority days (42.5%). Mean first review is four days after onset. Clinical precision/recall and useful advance warning are unestablished. [Full result](ALGORITHM_V3_2026_10_30.md)

The separate SMS model has 26,912 authored normalized examples. Four-class test accuracy is 84.6%; its review supplement has 97.3% precision and 29.8% recall on the synthetic held-out test, below release requirements. Keep it in shadow mode. [Full result](SMS_MODEL_EVALUATION.md)

## Earlier rounds

Round 1 documented the portal, risk/data foundation, one model draft and an initial SMS transport check. Subsequent implementation added the registered-phone HELP route, identified coordinator/family notices, cloud account improvements, medication monitoring and richer weekly-summary review controls. These are comparisons with documented checkpoints, not an invented reconstruction of the Round 1 source tree.

## Next acceptance work

Establish reliable voice-only access, complete the physical two-way SMS check-in test, obtain representative independently labelled outcomes, measure alert burden and senior accessibility, and benchmark cloud/device costs. Calling remains deferred. No unfinished path should be described as operational merely because its source exists.
