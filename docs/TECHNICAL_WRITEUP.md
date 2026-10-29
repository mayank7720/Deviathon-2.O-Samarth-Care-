# Samarth Care: current technical write-up

This is the current reference-informed and evidence-locked reporting edition. The [four-page PDF](Samarth-Care-Technical-Writeup.pdf) summarizes this edition; regenerate it with `scripts/build-writeup.py` after running the current evaluation. This Markdown and [data realism](DATA_REALISM.md) retain the detailed methods and limits. Earlier legacy-cohort precision / recall values do not transfer to this cohort, and no clinical accuracy is established.

## 1. Purpose and architecture

Samarth Care helps a coordinator decide which senior needs attention, why recorded signals changed, and what human action should follow. It does not diagnose or prescribe. All showcase identities and historical observations are fictional. Submitted readings, medicine logs and call answers become dated evidence, not invented past events.

React/Vinext serves coordinator, senior, family and operations roles. A Worker API checks verified identity, current membership and senior scope. Local D1 supports isolated fixture accounts; standalone Supabase provides Auth, Postgres/RLS, daily cache and a protected background processor. Replay or live India-time clocks control cutoffs and freshness. `SAMARTH_DATA_MODE=reference-informed` selects the newer cohort; `SAMARTH_COHORT_END` sets its end date. Legacy mode remains reproducible.

```text
Vitals / medicines / dated check-ins / optional phone motion
    -> Personal rules + Isolation Forest + shared cue extraction
    -> Urgency-ranked evidence and human next action
    -> Saved fact snapshot -> local renderer or configured n8n model
    -> Strict evidence-plan validation -> coordinator review
    -> Consent-checked family inbox / approved delivery channel
```

User requests use a publishable key and the verified caller's token. The separate locked background store uses server credentials only after private job authentication. Hosting, n8n inference and carrier delivery are distinct integrations; checked-in code alone does not prove a successful external execution.

## 2. Provenance and realistic simulation

Seed 1042026 generates **200 profiles, 90 calendar days and 17,226 observed senior-days** from 18,000 possible: 4.3% whole-check-in missingness. Modality schedules differ: glucose is more frequent in the simulated diabetes-history subgroup, BP in the monitoring subgroup, and weight at four-day intervals. Missing medicine logs are unknown, not missed doses. Profiles and records carry their synthetic origin and generator version.

Starting BP, non-diabetes glucose and weight distributions use aggregates from the official MITRE Synthea April 2020 sample at observation ages 60-110. One median per synthetic identity limits repeated-observation dominance. Compatible source counts are 296 identity medians for BP/weight and 220 for glucose; no compatible SpO2 data is claimed. The archive SHA-256 is recorded, and only aggregate distributions are committed. Synthea is itself synthetic US EHR data, not an Indian geriatric or independently observed home-care cohort. See [source details and assumptions](DATA_REALISM.md).

Daily serial correlation, noise, schedules, symptoms, medicine-taking and recovery remain explicit simulation assumptions. Notes agree with current dose counts. Individual dose statuses sum to the daily aggregate. Four mobility incidents each occur on one dated report, rather than inventing a new fall every day. Weight changes gradually through recovery. Structural checks cover dates, duplicates, broad numeric plausibility, pressure order, medicine counts, contradictory text and abrupt weight changes; the default cohort has zero hard inconsistencies. Passing these checks does not establish clinical validity.

Sixteen identities receive authored multi-signal, medication, appetite or mobility review scenarios. This 8% mix is a stress-test choice, not prevalence. Labels include persistent changes through gradual recovery, with deterioration end recorded separately. Labels stay outside model fitting and report inputs. Incidental concerning readings outside scenario windows remain visible; unlabelled days are not declared healthy.

## 3. Risk, language and uncertainty

A local [Isolation Forest](https://doi.org/10.1109/ICDM.2008.17) has 48 trees, subsamples of 128 and nine features describing deviations in vitals, movement, sleep, logged adherence and note cues. The current cohort provides **2,099 rolling three-day development vectors** from first-30-day data of 150 identities. Every fourth identity is held out from forest fitting. Each person's own first 30 days supply the reference, including held-out seniors.

Rules contribute explicit points; the forest adds at most 22. Sufficiently supported scores of 60+ are high and 30-59 medium. Shared triage places immediate concerns ahead of ordinary numeric ranking. Rising or falling BP relative to personal history can prompt review. Sparse support and first-30-day warm-up return unknown/null; serious observed evidence stays visible. Historical warm-up never borrows a later baseline. Scores are illustrative prioritization, not diagnoses or calibrated probabilities.

Shared Hindi/English/Hinglish rules identify pain, confusion, appetite loss, poor sleep, loneliness, missed medicines and falls, with bounded negation and subject checks. A common other-person phrase such as "my daughter fell, but I am fine" is not attributed to the senior. This is limited lexical understanding, not general medical language comprehension; original dated evidence remains available for verification.

Nine-domain analysis exposes available evidence and gaps. Medicine analysis flags logged missed-day/time patterns and duplicate schedules; it is not an interaction database or treatment recommender. The three-day score projection is descriptive extrapolation with residual bands, not illness prediction. Permissioned foreground phone-motion aggregates can generate unconfirmed impact/orientation/quiet-period candidates. Phone movement does not establish a physical fall, and a still phone does not establish its owner's inactivity.

## 4. Reports grounded in evidence

`createReportFacts()` computes a dated fact snapshot from saved observations, rejecting other seniors, future/invalid dates and invalid measurements. Facts retain units, coverage, personal comparisons and source aliases. Missing days remain explicit. A local renderer produces English/Hindi reports without an LLM.

When n8n is configured, its model receives masked aggregates and an allowed fact-selection schema. It selects existing fact IDs, a warm opening/closing and the required follow-up; the server renders factual sentences. Free model prose, invented values, diagnoses, unknown/repeated facts, missing coverage, omitted immediate concerns and reduced urgency are rejected. Failed model output becomes a clearly labelled **Computed evidence report (no LLM)**. A valid result is **LLM-guided evidence-locked weekly report**, with provider/model and evidence linkage. This constrained generation task trades free-form prose for auditability.

HMAC, timestamp tolerance, durable nonces, job identity/expiry and evidence hash bind n8n claims and callbacks. Raw notes, names, contact details, senior IDs and original record identifiers stay in the care store. Masked derived health data remains sensitive. Workflow import files do not prove a configured model or actual execution. Every report remains a coordinator-review draft before family delivery, with current scope and sharing consent checked again.

## 5. Access, action and communication

The public landing exposes no care records. Supabase Auth sessions use HttpOnly cookies. Fresh membership, role and scope authorize requests; RLS prevents family accounts reading raw clinical events or full staff scores. Explicit safe representations and delivered messages serve linked roles. Invitation hashes are email-bound, single-use and expire in seven days. Revocation and consent withdrawal block subsequent access, including browser-call signaling.

Daily jobs/outbox identities deduplicate work. Alerts support acknowledgment, nonurgent snooze, new-evidence reopening and outcome-based resolution. Urgent reports cannot be snoozed. Recorded first-seen/acknowledgment measure response separately from task completion; an automatic help task does not imply human action. The usefulness-feedback model requires enough balanced labels and a valid identity-group split; its workflow estimate never lowers risk or suppresses urgency.

In-app messages and recipient receipts persist. Opt-in push carries generic text only. Provider acceptance differs from a human read. Delivery leases limit concurrent duplicate sends, while a provider crash boundary still demands cautious retry. Browser audio uses explicit microphone permission, protected two-party WebRTC, expiry and cleanup; network/device acceptance is separate from mocked tests.

The Hindi/English four-question flow supports a low-tech conversation. An operator can record an ordinary call; a signed bridge can submit bounded answers. Provider and Android/SIM paths need configured credentials or hardware, verified test contacts, current consent and actual receipts. Queued/accepted does not mean a phone rang, an SMS arrived or a senior answered. n8n orchestrates; it does not itself provide free carrier service. Current delivery documentation records which external paths were actually accepted.

## 6. Evaluation and practical limits

Positive annotations cover authored review scenarios; other days lack adjudicated outcomes. **Clinical precision, specificity, recall and F1 are not estimable.** Unlabelled high flags are not automatically false alarms, and unflagged days are not confirmed healthy. `createRealisticEngine()` returns null clinical precision/F1 and explicitly labels scenario coverage.

Fifty identities are held out from forest fitting, including four authored scenarios. Days 31-90 give 3,000 evaluated senior-days, with 80 annotated scenario-days for the selected seed.

| Reference-informed synthetic measure | Result |
| --- | --- |
| Medium/high human-review threshold | Existing score >=30, unchanged |
| Scenario-day review coverage | **48/80 = 60.0%** |
| Scenarios receiving medium/high review | **4/4** |
| Mean delay after authored onset to review | **3.75 days** |
| High-priority threshold | Existing score >=60, unchanged |
| Scenario-day high coverage | **16/80 = 20.0%** |
| Scenarios receiving a high flag | **3/4** |
| High-flag onset delay / lead before authored deadline | **6.0 / 4.0 days** |
| Unlabelled high senior-days | **49**, not presumed false alarms |
| Clinical precision / recall / F1 | **Not established** |

Rules-only high scenario-day coverage is 10.0% and 2/4 cases; combined is 20.0% and 3/4 on the same split. Thresholds were not tuned on these held-out results. Three seeds give 20.0%-31.3% high scenario-day coverage, 3-4 cases of four, and 49-62 unlabelled high days. These small authored cases and correlated daily records do not prove real-world accuracy. Earlier legacy figures do not transfer.

Run `node scripts/evaluate-realistic.mjs` for current quality, metrics, profiles, JSONL and separate scenario annotations. `npm run evaluate` reproduces legacy metrics. Behavior, build, hosted authorization and real device/provider acceptance are distinct. Expert-adjudicated data, clinical/operational validation, accessibility, alert-fatigue studies, retention governance and measured 10,000-person costs remain necessary. An indexed cache-read benchmark cannot establish those properties.

## References

1. Walonoski et al. *Synthea*. JAMIA 2018. [Primary paper](https://doi.org/10.1093/jamia/ocx079), [official downloads](https://synthetichealth.github.io/downloads.html).
2. Liu, Ting and Zhou. *Isolation Forest*. ICDM 2008. [Primary paper](https://doi.org/10.1109/ICDM.2008.17).
3. Supabase [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vault](https://supabase.com/docs/guides/database/vault), [scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions).
4. W3C [WebRTC](https://www.w3.org/TR/webrtc/), [Device Orientation and Motion](https://www.w3.org/TR/orientation-event/).
