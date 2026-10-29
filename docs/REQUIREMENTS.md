# DEV_104 implementation evidence

The supplied *Early Warning for Seniors Living at Home* brief defines product requirements. It does not authorize contacting real families or processing patient data. This showcase uses synthetic identities and signals only.

| Requirement | Implemented evidence | Limit |
| --- | --- | --- |
| Ranked daily priority view | Shared urgency-first coordinator queue with city/search, trend, reasons and next action; unknown scores request a fresh check-in | Replay/live clock does not manufacture current data |
| Three signal types | Vitals, medication counts/doses, Hindi/English notes; additional lifestyle and explicitly enabled foreground phone motion | Browser motion is foreground-only and unvalidated; a device impact is not a confirmed human fall |
| Unstructured understanding | Shared English/Hindi/Hinglish local cue extraction, bounded negation, subject filtering and dated evidence | No general LLM understanding or independent clinical language corpus |
| Rules plus anomaly model | Personal-baseline rules and 48-tree Isolation Forest; bidirectional BP changes, baseline warm-up and missing-data handling | No diagnostic claim; thresholds illustrative |
| Explainable action | Baseline comparisons, reasons, concrete human follow-up, task outcomes | Clinical and workflow validation still required |
| Named care ownership | Fictional local counsellor, care leader and backup per household; administrator-recorded assignments and two-family primary capacity | Operational planning does not grant account access or establish real staff availability; source context is in [SAMARTH_CONTEXT.md](SAMARTH_CONTEXT.md) |
| Human follow-up trail | Staff-only cases record a next action, contact attempts/results, leader escalation and resolution outcome; append-only revisions reject conflicting changes | Manual attestations do not prove carrier delivery, dispatch a service or clear a new risk flag; Operations can read, while scoped coordinators record cases |
| 200 seniors over 90 days | Reference-informed mode: 200 profiles and 17,226 observed records, provenance, correlated histories, modality-specific missingness and quality audit; legacy stress set retained separately | Synthea reference and generated records are synthetic; not real patient histories or an Indian population estimate |
| Metrics and early detection | Reference-informed partial-label evaluation: 20% high-priority scenario-day coverage, 3/4 held-out cases; at existing review threshold 30: 60% coverage, 4/4 cases, mean 3.75 days after onset | Unlabelled days cannot establish clinical precision/F1; legacy 93.7% figure is not transferred to this mode |
| Senior accessibility | Simple check-in; four-question Hindi/English keypad bot; coordinator-assisted call entry; signed ingestion; optional local speech | Actual autonomous call requires a connected credited trial provider; Android assisted SIM calls require pressing Call |
| Family summary | Dated facts, evidence aliases, coverage, optional n8n/LLM-guided evidence-locked plan, safe renderer and coordinator-approved delivery | n8n workspace/provider/credits remain to be connected; computed fallback is explicitly labelled, not presented as LLM success |
| Operations | Alert counts, first recorded acknowledgment latency, separate task completion duration, city/team aggregation and documented outcomes | Historical latency exists only when actual lifecycle timestamps were recorded |
| Access control | Sites identity or standalone verified Supabase email/password; assigned roles/scopes, email-bound invitations and immediate revocation | Public landing only; loopback fixture accounts are separate |
| Consent and privacy | Consent rechecked for family records, summaries, alerts, messages and voice signaling | Retention, organizational policy and real-data adoption need governance |
| Alert fatigue | Daily deduplication, acknowledgment, outcome, nonurgent cooldown/snooze, urgent bypass | Field false-alarm burden not measured |
| Feedback loop | Local logistic usefulness supplement after sufficient class-balanced labels | Senior-group holdout; never reduces clinical urgency; may remain untrained |
| Trend and domain insight | Nine-domain analysis and descriptive three-day linear projection with residual band | Does not predict illness or provide medical probabilities |
| Medication patterns | Logged adherence, missed-day/time patterns and duplicate schedule review | No medication-interaction database or treatment advice |
| Fall/inactivity stretch | Real foreground phone-motion events and quiet-period aggregates, explicit save and unconfirmed human-review candidate; submitted sensors and note rules remain supported | Compatible phone and permission needed; no continuous background/wearable coverage or certified detector |
| Communication | Protected inbox/read receipts, WebRTC browser audio, generic browser push, approved contacts, USB-local Android SMS adapter with actual state receipts and assisted real dialer | Device pairing and one live owned-number test remain; SIM charges/limits apply, autonomous bot needs provider credits; no hardware delivery inferred from tests |
| Daily processing | Inspectable India-time live clock or deterministic replay, stored daily scores, deduplicated alerts/outbox and retryable processing | Manual/local execution and hosted scheduling must be verified separately |
| Low cost | No paid inference, telecom or relay key required; source runs locally | Hosting quotas/costs and 10,000-person scale not proven |
| Deliverables | Source, README, technical write-up, evaluation exports and five-minute script | Repository audience and hosting access follow owner settings |

## Further acceptance work

Validate thresholds, multilingual extraction, missed incidents, alert fatigue and action wording with domain experts and representative governed data. Test actual microphone/audio quality with two distinct authorized accounts on compatible devices. Test keyboard, low-vision and hearing accessibility with intended users. A real phone integration needs hardware or provider infrastructure, caller identity, consent, delivery evidence and escalation operations. Benchmark 10,000-person model computation and actual cloud storage/delivery cost before scale claims; an indexed cached-read benchmark alone cannot establish these.

Run `npm test` for implementation checks and `npm run evaluate` for the deterministic dataset and metrics. Final test/build/browser/deployment status is recorded separately; no fixed test count is promised here.

`tests/care-operations-hosted-rollback.sql` verifies database enforcement of administrator assignment access, saved city capacity, verified actors, sequential case revisions and contact/outcome evidence. It uses temporary synthetic users and rolls back every fixture. The private validation roster follows the reference-informed cohort; changing that cohort's identities or cities requires a matching migration. Care operations uses a separate indexed event scan; reaching its 5,000-event bound returns an explicit service error rather than resetting ownership or case history.

No real patient dataset or pretrained clinical model weights are used. The new generator uses aggregate distributions from a cited external **synthetic** Synthea archive; its provenance, hash and assumptions are in [DATA_REALISM.md](DATA_REALISM.md). The anomaly algorithm follows [Liu, Ting and Zhou, ICDM 2008](https://doi.org/10.1109/ICDM.2008.17). See [n8n/report grounding](N8N.md), [actual phone setup](TELEPHONY.md), [analytics](ANALYTICS.md), [access](ACCESS.md), and the [current checkpoint](DELIVERY_2026_10_29.md) for implementation and acceptance boundaries.
