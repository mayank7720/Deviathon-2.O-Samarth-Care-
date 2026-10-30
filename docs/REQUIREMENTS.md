# DEV_104 coverage

The assigned brief requests an early-warning prototype for seniors living at home. The showcase uses synthetic identities and signals. It does not establish clinical safety or real-world early detection.

| Requirement | Implemented evidence | Remaining limit |
|---|---|---|
| Three signal types | Dated vitals, medication logs and free-text/call-note records | Invalid, missing and conflicting measurements remain explicit |
| Unstructured understanding | English/Hindi/Hinglish cue rules with assertion, negation and subject checks; optional reviewed local speech drafts | Bounded vocabulary; no independent clinical language validation |
| Daily rules plus ML | Personal-reference rules, calibrated 48-tree Isolation Forest and sustained-change evidence | Synthetic model evaluation; insufficient data can cause abstention |
| Explainable action | Urgency-ranked queue, dated reasons, personal comparisons and suggested human contact | Recommendations need human verification |
| 200 seniors over 90 days | Reference-informed fictional cohort, gaps, noise and authored decline/recovery cases | 17,226 observed entries in the default seed; no real patient cohort |
| Low-tech access | Registered-phone HELP SMS and coordinator-assisted input | Voice/simple-call requirement remains incomplete; SMS alone does not cover every senior |
| Family information | Consent-bound serious/support notices and reviewed weekly summaries | No automatic weekly inference or auto-approval schedule |
| Operations | Account administration, assignments, unresolved work and recorded outcome metrics | Manual activity records do not prove completed care |
| Alert fatigue | Deduplication, explicit uncertainty, current evidence and repeated-change checks | Real-world false-alarm burden is unmeasured |
| Privacy | Current role/scope checks, database policies, family consent and masked report facts | Production governance, retention and independent audit remain outstanding |
| Low cost | Local scoring and existing showcase allocations | 10,000-senior capacity and production cost are unproven |

## Stretch goals

| Goal | Status |
|---|---|
| Hindi voice check-in bot | Under development; no completed physical application bot call. Excluded from this showcase. |
| LLM weekly summary | Real n8n model draft accepted and saved; evidence, review and family-sharing controls implemented |
| Fall/inactivity | Experimental foreground device evidence and unconfirmed candidates; no validated continuous wearable monitoring |
| Feedback learning | Feedback capture and experimental usefulness code exist; an improving deployed model is not established |
| Medication interactions or patterns | Logged missed-dose and recurring timing patterns implemented; drug interactions not implemented |

## Evaluation

Current risk results and exact denominators are in [personal risk v3](ALGORITHM_V3_2026_10_30.md). Representative synthetic review-day coverage is 28/40 (70%) across two authored cases, with mean first review four days after onset. Clinical precision/recall and useful advance warning are unestablished. Earlier stress-test results cannot be transferred to this cohort.

The separate trained SMS supplement failed its release criteria and stays in shadow mode. [SMS model evidence](SMS_MODEL_EVALUATION.md)

## Deliverables and evidence

Source and setup: [README](../README.md), [quick start](QUICKSTART.md), [architecture](ARCHITECTURE.md), [demo](DEMO_SCRIPT.md), [data provenance](DATA_REALISM.md), frozen evaluation exports and tests. Earlier presentation/PDF files are historical submissions; consult [current status](PROJECT_STATUS.md) for present integration acceptance.

No diagnosis, medicine change, emergency dispatch or guaranteed response is claimed.
