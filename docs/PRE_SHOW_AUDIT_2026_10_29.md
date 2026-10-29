# Samarth Care: pre-show audit, 29 October 2026

Verdict: a substantial working prototype, with demonstrated integrations, but not ready to present every requested capability as complete. The largest gaps are alert correctness, evaluation, durable communications, autonomous Hindi calls and public-release consistency.

## Scope and evidence

- Re-read all three pages of `DEV_104.pdf` (provided problem statement); extracted text is `outputs/DEV_104-source.txt`.
- Audited local and fetched GitHub `main` at `0e534be02a045ec6e74e9081d0482b1bbe6b28d7`. Both matched at the final fetch. The collaborator's `1c80d58` UI changes are included. Working tree remained clean.
- Current source: all **277 tests passed**, production build passed. Additional targeted AI tests passed, but adversarial probes exposed missing cases. Passing implementation tests does not establish model quality or live deployment correctness.
- Read-only Supabase checks: 200 scores dated 2026-10-29, one authenticated user, one membership in each of four roles, zero feedback events, two generated reports pending review, one completed report job, one SMS job delivered. Database delivery records are separate from SMS carrier receipts and must not be conflated.
- Four protected Edge Functions are active; background cron is active every 15 minutes. Seventeen migrations are recorded in the hosted project.
- Existing saved integration evidence: one real GPT-5 mini report execution through n8n; one owned-number SMS delivered through SIM 2; one English local Whisper transcription. No new inference, calls or SMS were initiated for this audit.
- Public release evidence identifies version 4 at source `8832163`. This is behind current GitHub. Current live rendering was not re-tested: browser automation still reports disabled. The Sites connector previously lost project access. Do not substitute source inspection for a live browser acceptance result.
- During the audit, application source was not edited, committed, merged or deployed. This document records the audit checkpoint above; publishing it does not mean the listed fixes are implemented.

## PS coverage

| PS item | Current evidence | Remaining work |
|---|---|---|
| Vitals, medication logs, text/voice notes | Implemented data paths; synthetic cohort and coordinator entries | Rehearse an end-to-end intake and resulting action |
| Hindi/English cue extraction | Local rules/lexicon and local multilingual STT | Negation, historical context and transliteration defects; no held-out language accuracy benchmark |
| Rules plus ML/anomaly detection, personal baseline | Real fitted Isolation Forest, personal historical features, explicit rule reasons | Poor current scenario coverage/delay; independent validation and operating threshold selection |
| Urgency-ranked coordinator view with reasons/action | Implemented | Live rendering and review workflow acceptance on released commit |
| At least 200 seniors for 90 days | Met: 200 identities, 17,226 observations, missingness/noise/planted cases | Improve evaluation annotations and document limits; data is synthetic, not Indian clinical validation |
| No diagnosis, human routing | Grounded reports and human review gates implemented | Preserve this in every public view and presentation claim |
| Low-tech senior voice/simple call | Coordinator-assisted telephone workflow and note intake available in code | Demonstrate an actual basic-phone conversation reaching a reviewed note and ranked action |
| Privacy / role scope / family consent | Supabase Auth, RLS, scoped policies, masking and consent gates | Distinct-user acceptance, live n8n retention verification and operational retention |
| Affordable at 10,000+ seniors | Local models, cached scores, compact cache benchmark | Full workload/cost evidence; event history and execution-budget issues below |
| Required evaluation metrics | Partial-label scenario coverage and onset delays reported honestly | Proper planted-case precision/recall and earliness evaluation still incomplete |
| Repository, max-four-page write-up, five-minute demo | Public repository, four-page PDF and script exist | Align stale claims, update checkpoint, rehearse final released flow; no finished presentation deck was established in this audit |

## P1: finish before presenting the affected feature as complete

### 1. False immediate alerts from ordinary language

Reproduced source probes:

- `I don't have chest pain` extracts chest pain and routes to immediate triage.
- `I had a fall last year, but I am fine today` routes to immediate triage.
- `Mujhe bhukh nahi lag rahi` extracts no appetite cue.

Evidence: `lib/triage.mjs:9,34,47`. Negation handles selected words but misses contractions; historical/resolved context is not resolved. This directly undermines the PS alert-fatigue and mixed-language requirements.

Completion: regression tests for contractions, explicit historical/resolved events, other subjects, uncertainty, conditional advice and common Hindi transliterations; separately labelled held-out cue corpus with cue precision/recall. Uncertain meaning should route to human clarification without inventing a confirmed current emergency.

### 2. Early-warning performance is not yet established

Default reference-informed evaluation, on four held-out authored scenario identities:

| Operating threshold | Scenario-day coverage | Cases flagged | Mean first flag relative to onset |
|---|---:|---:|---:|
| High priority, score 60 | 16/80 = 20% | 3/4 | 6 days after |
| Review, score 30 | 48/80 = 60% | 4/4 | 3.75 days after |

Appetite scenario high-priority coverage is 0/27 days. There are 49 unlabelled high-priority days; these cannot be called false positives or confirmed true positives. Current precision/F1 are null for good reason. The old 93.7% precision figure belongs to a different legacy authored benchmark and cannot describe this cohort.

Evidence: `outputs/realistic-evaluation.json`; `lib/realistic-cohort.mjs:164`; `docs/DELIVERY_2026_10_29.md:16`.

Completion: separate development and held-out identities/seeds; explicit, independently reviewed synthetic positive and negative windows including incidental abnormalities; freeze thresholds before final evaluation. Report precision, recall, false alerts per coordinator/day, missed-case categories and delay/earliness against a documented reference point. Do not relabel all unannotated days healthy or tune against the final four cases. More model fitting alone does not solve missing evaluation truth.

### 3. Relay heartbeats compete with clinical/contact history

The idle relay appends two events every 15 seconds, potentially about 11,520 rows/day. `rowsFor()` requests the latest 5,000 records across heartbeats, nonces, contact changes, signals and other state. At that steady rate, heartbeats alone can fill the window in about 10.4 hours. Older state can disappear from the application snapshot. Current database counts are much smaller; this is a source-demonstrated growth path, not a claim that 11,520 rows already exist.

Evidence: `scripts/android-relay.mjs:57,67`; `lib/telephony-routes.mjs:113`; `lib/api.mjs:119`; `lib/workflow-store.mjs:49`.

Completion: replaceable device status, expiring nonce storage, separate indexed state/clinical queries and explicit pagination. Test sustained relay operation beyond the snapshot limit, including contact changes and consent revocation. Do not infer that this alone bypasses the separate database RLS/consent checks.

### 4. Autonomous Hindi carrier calls are prepared, not proven

Android ACTION_DIAL opens the phone dialer; a person must press Call. The Linux/Asterisk/BlueZ SIM bridge has prepared files but no supplied Linux host or actual end-to-end carrier call. No autonomous four-question Hindi call has been accepted and transcribed into a reviewed record.

Evidence: `docs/FREE_CALL_BRIDGE.md:5,29,74`; `scripts/sim-call-worker.mjs:26`; `scripts/android-relay.mjs:38`.

Completion for the optional bot: establish the supported host/hardware path; use a consented owned test destination; verify call connection, Hindi prompts, 3–4 answers, reviewed transcription, note ingestion and resulting action. Handle no answer, silence, opt-out, interruption and uncertain call outcome. A basic coordinator-led call remains a valid mandatory accessibility path, but must be demonstrated separately. n8n execution credits do not provide a telephone carrier.

### 5. Actual n8n execution-data privacy settings remain unverified

One successful synthetic execution saved its input/output. Exported settings request no saved executions, but import did not preserve all settings. Browser settings changes were interrupted before a saved/published confirmation. `store:false` at the model provider is separate from n8n execution retention.

Completion: verify and save the actual workflow's success/error/manual/progress retention settings, publish as required, then verify a permitted synthetic execution does not retain its content. Do not claim that a JSON export proves live privacy settings.

Official reference: https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data.md

### 6. Public website and repository are different releases

Public checkpoint `8832163` predates current `0e534be` and lacks the collaborator's family-summary object guard, sign-out relocation and newer integration source. The old JSX has a source-confirmed path that can render an object; current source guards it. Live reproduction remains unverified.

Completion: choose one release commit, publish that commit through an authorized working host, record deployment provenance, then run the four-role and communication acceptance flow against that URL. New public-site AI requests remain disabled under the user's explicit choice to keep them local for now; do not describe them as enabled.

## P2: reliability, stretch-goal and product gaps

7. **SMS late-receipt recovery:** relay polls for roughly three minutes, then stops. Accepted/sent jobs are not rediscovered on restart; the receipt lease expires after ten minutes. A late carrier delivery may never update the app. Reconcile the original gateway identifier durably without resending; surface unknown/stale states. Evidence: `scripts/android-relay.mjs:43`; `lib/telephony-routes.mjs:102,134,141`.

8. **Relay falsely offline during a healthy send:** a sequential three-minute delivery wait blocks a heartbeat whose freshness threshold is two minutes. Renew independently of job polling. Evidence: same relay loop; `lib/telephony-routes.mjs:79`.

9. **n8n failure lifecycle:** after an accepted request, inference/validation/callback errors have no signed failure branch. The app can show processing until the 24-hour expiry. Add terminal failed/timed-out states and deliberate recovery; never blindly trigger a second inference after an uncertain first result. Evidence: `lib/n8n-hooks.mjs:23–48`; `lib/report-routes.mjs:62`; workflow graph.

10. **Fallback reports omit nonacute concerns:** a note containing loneliness, low appetite and confusion produces those facts, but deterministic selection can render coverage only. This matters especially on computed/provider-failure paths. Include relevant note concerns with evidence and appropriate action. Evidence: `lib/grounded-reports.mjs:120`; reproduced by an audit probe.

11. **LLM-to-family acceptance remains unfinished:** one genuine n8n/GPT-5 mini result is saved pending review; actual approval, consent-checked inbox delivery and family read were not demonstrated for that report. The completion RPC does contain delivery-queue code, so this is an acceptance gap, not an assertion that queuing is absent. Two generated reports currently await review.

12. **Hindi/Hinglish speech quality unmeasured:** a genuine English 11-second fixture passed local transcription; Hindi health terms, medicine names, numbers, negation and telephone-quality audio have not been benchmarked. Human review remains necessary. Local Whisper runs on the laptop; a phone's localhost does not reach that laptop. Public-browser microphone/local-network permission remains unverified. Evidence: `docs/LOCAL_SPEECH.md:7,41`.

13. **Feedback stretch is collecting data, not demonstrated learning:** hosted feedback event count is zero. Training requires at least 20 usable labels, five per class and a viable senior-group holdout. The usefulness supplement is not the primary risk detector; do not claim clinical risk improves from current live feedback. Demonstrate a measured held-out change with honestly labelled showcase feedback. Evidence: `lib/analytics.mjs:958,1158,1210`.

14. **Motion stretch is partial:** actual device-event processing is implemented, but the session stops when hidden and is explicitly unvalidated. No continuous wearable/background detector or accepted hardware evaluation is established. Demonstrate a supported foreground session and label candidates for human verification. Evidence: `app/components/MotionCheckin.tsx:19,30`.

15. **Browser voice is not carrier calling:** WebRTC uses no STUN/TURN; two authorized identities and suitable network connectivity are needed. Current owner cannot call itself as another distinct person. Cross-network and two-device audio are unverified. Evidence: `lib/communications.mjs:491`; `app/components/VoiceRoom.tsx:442`.

16. **Four roles, one live user:** actual database has one authenticated account with all four memberships. This is useful administrator role switching, not a demonstration of four isolated logins. Use separate restricted identities for coordinator, senior, family and operations; prove cross-senior denial and consent revocation. Existing rollback policy tests are valuable but separate from browser acceptance.

17. **Account recovery absent:** auth routes support login/register/logout/refresh only; no recovery UI/backend path. Complete reset/return-URL/error flow or clearly mark it unavailable. Evidence: `lib/supabase-auth.mjs:86`; `app/components/AccessPortal.tsx:499`.

18. **Family retrieval errors are hidden:** summary fetch failures are discarded and generic wellbeing prose is shown without distinguishing unavailable/stale data. Add explicit loading/error/date/provenance states. Evidence: `app/page.tsx:2506,2569`.

19. **Multiple linked seniors not supported in family view:** it selects `seniors[0]`. Add a linked-senior selector if demonstrating support for both parents. Evidence: `app/page.tsx:2496`.

20. **Raw call recording retention:** prepared Linux bridge cleanup is manual. Before real use, add private bounded retention and cleanup after review, with an explicit retention period. Evidence: `docs/FREE_CALL_BRIDGE.md:93`.

21. **Synthetic plausibility is not clinical validation:** 200×90 requirement is met. Calibration references US Synthea synthetic aggregates; SpO2/lifestyle/adherence/notes include authored assumptions. Preserve citations, seed, provenance, structural checks and missingness; do not present this as real Indian patient training. Evaluate more independent authored scenarios rather than merely expanding row counts.

22. **10,000-senior cost/scale unproven:** the existing 10,000-row cache benchmark is not full scoring/ingestion/notification load. A report execution per senior per week already means roughly 40,000 executions per four weeks at 10,000 seniors, above the reported 10,000 allowance before retries. Batch or schedule selectively, retain cheap computed reports and measure actual model-token cost, scoring runtime/memory, database growth and coordinator alert burden. A single Android SIM is showcase hardware, not a proven fleet architecture.

## Vercel deployment

There is no established Vercel deployment in the audited evidence. This repository currently builds a Cloudflare Worker, imports `cloudflare:workers`, and uses Worker bindings/request context. A default Next/Vite deployment is not an established port.

Current vinext documentation supports other platforms through Nitro; Vercel documents Vite + Nitro. This means Vercel is possible, not that the installed vinext beta and current Worker-specific API already work there. Finish the adapter/environment mapping, retain Supabase database and scheduler, update callback/auth origins and prove production API/cookie behavior before switching the showcase URL. Local USB/Whisper services still require the laptop after any frontend-host change.

Evidence: `vite.config.ts:60`; `app/api/[...path]/route.ts:1`; `worker/index.ts:31`.

- https://github.com/cloudflare/vinext#other-platforms-via-nitro
- https://vercel.com/docs/frameworks/full-stack/vite-with-nitro

## Lower-priority cleanup and presentation accuracy

23. **Security-advisor follow-up:** Supabase reports leaked-password protection disabled and `pg_net` in public schema. Review supported remediation and plan availability; neither warning alone establishes a demonstrated access breach. Do not drop or alter a nonrelocatable extension merely to silence a linter.

- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public

24. **Stale claims:** `docs/REQUIREMENTS.md`, parts of the public tour and front-door AI text predate genuine n8n/SMS progress. The demo script's Hindi voice wording must distinguish prepared bot, coordinator-assisted calls and verified model inference. Update all materials from one evidence matrix.

25. **Final runtime acceptance:** current build/tests pass, but narrow mobile layout, four distinct roles, microphone permissions, public callback flow, family report reading and failure recovery need one final browser/device rehearsal on the released commit. The four-page PDF meets the page cap; the final pitch/demo needs a timed five-minute run. Do not let an optional gateway setup consume the entire presentation.

## Stretch-goal status to present honestly

| Extra credit | Status |
|---|---|
| Hindi 3–4-question outgoing bot | Prepared; no actual autonomous carrier call |
| LLM weekly summary | Genuine local request/GPT-5 mini result; review-to-family acceptance outstanding |
| Fall/inactivity sensors | Foreground prototype; hardware acceptance and detector validation outstanding |
| Useful/not-useful learning | Training code exists; live data zero, improvement not demonstrated |
| Medication interaction OR missed-dose patterns | Missed-dose pattern flags implemented; interaction database is not required by this alternative |

## Recommended completion order and collaboration

1. Fix demonstrated NLP and report omissions; add focused regression tests. Repair heartbeat/history growth and SMS/n8n terminal-state recovery.
2. Establish independently labelled synthetic evaluation and held-out language checks; measure alert burden and detection delay before optimizing thresholds or adding models.
3. Prove coordinator-led basic-phone intake, then complete the optional bot only through a supported, consented hardware/provider path. Finish family-report review/delivery and feedback/motion acceptance.
4. Create distinct demo identities, complete live retention settings and select one public hosting route. Deploy a frozen commit; verify actual URL behavior.
5. Align README, PS matrix, four-page write-up, pitch and five-minute script with measured evidence. Keep genuine saved integration receipts as a clearly labelled backup.

The collaborator's commits are preserved. Use separate branches/PRs, one database-migration owner, passing CI and a named release commit. Re-fetch before any eventual merge/deployment; this report describes a checkpoint, not future commits. No force push, reset, stash or source edits were made during this audit.
