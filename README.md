# Samarth Care

[Round 1 presentation](docs/round1/CodeBurner-DEVS09-Samarth-Care-Round1.pptx) · [Concept and technical brief](docs/Samarth-Care-Technical-Writeup.pdf) · [Five-minute demo script](docs/DEMO_SCRIPT.md)

**Latest algorithm release:** [personal-risk-v2](docs/ALGORITHM_UPGRADE_2026_10_30.md) adds robust measured references, separate anomaly calibration, repeated-change detection, safer bilingual assertions and consistent medication uncertainty. It documents the measured gains and regressions on the unchanged synthetic benchmark; earlier slide/PDF figures are dated checkpoints.

An early-warning and care-follow-up workspace that helps a coordinator decide which senior needs attention, why their signals changed, and who owns the next step. Built for the DEV_104 hackathon brief using fictional identities and synthetic health signals.

The default data mode is **reference-informed**, with **200 seniors over 90 days** and a default replay date of **29 October 2026**. An administrator can replay the synthetic history or use today's date in India; live mode marks stale information rather than inventing observations. Risk scores route concerns to a human and do not diagnose conditions.

The operating model draws on Samarth's published care-team structure while recognizing that the company already offers family apps and describes AI-supported care. Our showcase demonstrates transparent early-warning evidence and recorded human follow-up. Staff names and assignments are fictional; no affiliation or connection to Samarth's private systems is claimed. See [official sources and operating context](docs/SAMARTH_CONTEXT.md).

The Vercel showcase is live at [Samarth Care](https://samarth-care-codeburners.vercel.app/). Operations Manager is the sole administrator. Separate coordinator, family and two senior accounts are provisioned; the family is linked to both seniors. [Accounts and mobile numbers](docs/ACCOUNTS.md) explains access and the administrator's add/change/remove phone controls. See [Vercel hosting](docs/VERCEL.md) for server configuration. New n8n AI generation remains available through the local app for now; the public site provides computed reports and saved authorized reports.

The [dated history archive](docs/HISTORY.md) persists the 200 profiles, 17,226 synthetic observations and 18,000 baseline score snapshots in Supabase for 1 August–29 October 2026. A senior profile's **Health history** supports day, calendar week, calendar month, 90-day and custom ranges without moving the shared replay clock. Separate readings retain measurement precision and save time; unknown times and missing days remain explicit. New and backdated observations project into durable history, with retryable score recalculation. Clinical event reads paginate independently of relay heartbeats.

## Run locally

The [29 October pre-show audit](docs/PRE_SHOW_AUDIT_2026_10_29.md) is a dated checkpoint, not a live status page. Use [showcase status](docs/SHOWCASE_STATUS.md) and the linked integration notes for current capabilities and limitations.

On Windows, double-click **Start Samarth Care.cmd** in this folder. It installs missing dependencies, prepares the server-side Supabase configuration and starts real Supabase sign-in at **http://127.0.0.1:5173**. Keep the terminal open. The existing owner signs in as Operations Manager; the other showcase users have separate credentials. The workspace is already provisioned. Private access details remain in ignored local files and are never included in tracked source.

Requires Node.js 22.13 or newer, npm, and Git. The same Supabase launch from this directory is:

```powershell
npm ci
npm run supabase:configure
npm run dev:supabase
```

For the separate local D1 fixture showcase, stop the Supabase server first, then run:

```powershell
npm run db:init
npm run dev
```

The fixture alternative uses explicit fictional demo identities and does not exercise hosted Supabase authentication. Open the loopback URL printed by the development server, normally `http://localhost:5173`, and keep the server running. No paid AI or telecom service is required for either mode's scoring and computed reports. To build the source and preview the local fixture build:

```powershell
npm run build
npm start
```

Cloudflare D1 supports the local fixture showcase. Standalone Supabase mode provides verified email/password sign-in, caller-scoped Postgres storage and row-level access controls; see [Supabase setup](docs/SUPABASE.md). Local preview and hosted databases are separate. `db:init` applies the checked-in schema to local D1; it does not change a hosted database.

The connected project has an initialized owner workspace, showcase accounts across four role types, current senior scores, a persistent 90-day history archive, protected background processing and a scheduled job. Operations manages other accounts through the account console. `npm run notifications:setup` creates ignored local browser-push keys. See [Supabase setup](docs/SUPABASE.md) for account boundaries and [automatic processing](docs/SCHEDULER.md) for delivery semantics.

The [current technical write-up](docs/TECHNICAL_WRITEUP.md), [four-page PDF](docs/Samarth-Care-Technical-Writeup.pdf) and [five-minute demo script](docs/DEMO_SCRIPT.md) describe the reference-informed mode and its measured limits.

Run the behavior checks with `npm test`. Reproduce the deterministic model report and export the synthetic dataset with:

```powershell
npm run evaluate
```

This writes four files under the ignored `outputs/` directory: `evaluation.json` contains aggregate metrics and methodology; `synthetic-cohort.jsonl` contains 17,645 observed daily records; `synthetic-seniors.json` contains 200 fictional profiles; and `ground-truth.json` contains evaluation-only planted labels and held-out episode outcomes. Join observations to profiles using `seniorId`. Use `npm run evaluate -- --metrics-only` to write only the aggregate evaluation report.

That command intentionally reproduces the **legacy stress test**. The default application data mode, `SAMARTH_DATA_MODE=reference-informed`, is evaluated separately with `node scripts/evaluate-realistic.mjs`. It contains 17,226 observations with explicit provenance, correlated histories, modality-specific missingness and consistent dose logs. See [data realism and reference limitations](docs/DATA_REALISM.md); neither cohort is a real patient's record.

With the local server running, `node scripts/smoke-local.mjs` verifies the four fixture accounts, analysis, alert safety, inbox messages, Hindi IVR answers, and consent against the actual HTTP API. It saves clearly synthetic demonstration events in local D1 and sends no external communications.

## Demonstrate the workflow

1. Open the coordinator dashboard and review the ranked daily queue. Search for a senior or narrow the queue by city and urgency.
2. Open a senior to inspect changes against their personal baseline, recent signals, and plain-language reasons.
3. Add a vital reading, medication log, or Hindi/English note and observe the updated risk explanation.
4. Create a follow-up task, record its outcome, and mark whether the alert was useful.
5. Open detailed analysis for nine wellbeing domains, the three-day trend projection, data completeness, medication patterns, and the supported weekly summary.
6. Acknowledge an alert, record an outcome, or snooze a nonurgent alert. Urgent reports cannot be snoozed; fresh urgent evidence reopens a handled alert.
7. Run daily processing, approve the weekly family draft, inspect queued/delivered/read outcomes, and optionally enroll the current browser for generic push notifications. Consent and recipient access are checked before delivery.
8. Use the care inbox, Hindi/English four-question phone simulator, and optional browser voice room. Review the consented family view and operations overview with the appropriate assigned account. A coordinator can record answers from a simple call; a signed [phone ingestion gateway](docs/PHONE_GATEWAY.md) accepts structured answers from a trusted operator or bridge.
9. In **Evidence & reports**, inspect dated facts, source evidence and coverage. Generate a computed report or, in the configured local app, request an n8n/Gateway model report. Review accepted drafts before family delivery. Unconfigured or failed inference is never labelled a successful LLM result.
10. In **Phone & SMS**, approve an owned test destination and pair the [Android relay](docs/TELEPHONY.md) to send a real generic SMS through your SIM or open the device's assisted-call dialer. In the senior view, explicitly start and save a phone-motion observation on a compatible phone.
11. Start **Start Local Transcription.cmd**, then use **Voice notes & transcripts** to record or upload consented audio, inspect the local Whisper output, correct it and explicitly approve it as a care note. Saved drafts do not affect scoring before approval. See [local speech setup](docs/LOCAL_SPEECH.md).

**Care APIs require verified identity and an active assigned membership.** Local and public Supabase modes use server-mediated email/password authentication, confirmed Auth email status and HttpOnly cookies. Operations is the sole administrator; the showcase coordinator, family and senior logins have their own restricted assignments. The role selector offers only roles already assigned to that account. See [accounts](docs/ACCOUNTS.md), [access and invitations](docs/ACCESS.md) and [Supabase setup](docs/SUPABASE.md).

On loopback development only, the landing page offers explicit local fixture accounts. Sign out before entering another local role. These fixtures are absent from hosted access; they contain fictional records and are for testing.

## Free showcase capabilities

No paid inference service is required for local scoring or evidence-grounded computed reports. The user's n8n Pro allocation is 10,000 monthly workflow executions. The [Gateway report workflow](https://samarth-care.app.n8n.cloud/workflow/m8dThX9iEttuaHni) is published and connected to the local app. Its first signed synthetic request succeeded in 11.001 seconds using `gpt-5-mini-2025-08-07`, without a computed fallback, and saved a 598-character report as `pending_review` in Supabase. It has not been approved or delivered to family. The workspace showed $2.00 in Gateway credits before this test; that is not a current-balance or unlimited-use claim. New AI requests remain disabled on the public site by the user's choice. The [n8n setup](docs/N8N.md) distinguishes execution, Assistant and Gateway allowances.

Actual local faster-whisper transcription is installed and tested through the signed HTTP flow. An 11-second English sample took about 3.1 seconds on this CPU; replay returned 409. This is a functionality/timing sample, not a Hindi, mixed-language or clinical accuracy benchmark. The public browser can use the exact allowed public origin to reach its paired laptop service; that still needs the local process and any browser local-network permission. Browser microphone and public-to-loopback UI acceptance remain unverified. Read-aloud uses installed local voices, with text as a fallback.

In-app messages really persist in the authorized inbox. The original SMS/IVR simulator remains labelled. **Phone & SMS** uses the installed official SMS Gateway for Android through a USB-local relay. One generic English test SMS to the user's approved owned number was delivered through SIM 2: accepted, sent and handset-delivery receipts were saved in the public app. Delivery does not prove human reading. The user confirmed the SIM includes SMS; carrier limits still apply. The paired relay must remain running to process approved jobs. No carrier call has been made. A [Linux/Asterisk Bluetooth SIM bot](docs/FREE_CALL_BRIDGE.md) is prepared with four Hindi/English questions and recording consent, but stays disabled until Linux and verified two-way phone audio are available.

Browser voice is real two-party WebRTC audio, with explicit microphone permission and no recording, transcription, STUN or TURN relay service. Use two distinct authorized accounts on a compatible network; cross-network connections may fail. Live two-device audio is a separate acceptance check.

Running locally needs no paid inference or communication service. Hosting resource charges, account quotas, and performance at 10,000 seniors depend on the hosting plan and have not been established as free or validated at scale.

## Models and data

- Two explicit synthetic modes: the legacy authored stress test, and a newer reference-informed 200-person/90-day generator with individual baselines, temporal correlation, missingness, medication consistency and dated incidents. The latter uses aggregate older-adult distributions from an open Synthea synthetic sample; it is not clinical validation or an Indian population estimate.
- Personal-baseline rules plus a small Isolation Forest implemented locally in JavaScript. No hosted LLM or external model API is required.
- Hindi, English, and common Romanized Hindi cue extraction with evidence snippets and negation handling. This is a transparent lexicon pipeline, not a general language model.
- The **legacy-only** benchmark reports 93.7% precision, 74.2% recall and 82.8% F1 over 3,000 senior-days; these figures do not transfer to the reference-informed mode. On the newer mode, authored scenario coverage is 20.0% at the unchanged high-priority threshold of 60 (three of four held-out cases) and 60.0% at the existing human-review threshold of 30 (four of four cases, averaging 3.75 days after onset). Unlabelled days cannot establish clinical precision/F1, so those values remain null. These weak spots are disclosed rather than hidden. See [DATA_REALISM.md](docs/DATA_REALISM.md) for separate labels and exact denominators.
- Queue ordering prioritizes immediate human attention ahead of same-day numeric scores. Sparse observations and the initial baseline warm-up display an unknown score; missing information is never presented as stable health.
- Nine-domain analytics, a descriptive three-day projection with residual bands, dated evidence-grounded reports, optional n8n/LLM-guided evidence-locked plans, and explicit foreground phone-motion input. Missing values and unconfirmed motion candidates retain those labels; no model can invent an observation or confirm a fall.
- A local logistic feedback supplement can train after at least 20 numeric examples, including five useful and five not-useful labels, with a valid group-held-out split. It estimates coordinator-rated usefulness and never lowers urgency or changes the clinical score.

No real patient records or pretrained clinical weights are used. A bounded external **synthetic** reference is reduced to committed aggregate distributions with provenance and archive SHA-256. Optional generative model inference is separate from the locally fitted anomaly detector. The anomaly-model design follows Liu, Ting, and Zhou, [*Isolation Forest*, ICDM 2008](https://doi.org/10.1109/ICDM.2008.17).

## Project guide

| Area | Purpose |
| --- | --- |
| `app/` | Responsive React interface and server API routes |
| `lib/engine.mjs` | Synthetic cohort, cue extraction, scoring, and evaluation |
| `lib/access.mjs` | Verified identity, assigned memberships, invitations, and care scope |
| `lib/analytics.mjs` and `lib/analysis-routes.mjs` | Detailed analysis, local summaries, feedback model, and alert lifecycle |
| `lib/communications.mjs` and `lib/communication-routes.mjs` | Persistent care inbox, IVR simulation, and browser audio signaling |
| `lib/daily-workflow.mjs`, `lib/runtime.mjs`, `lib/delivery-routes.mjs` | Daily score cache, replay/live clock, consent-checked delivery and opt-in generic browser push |
| `lib/phone-gateway.mjs` | Signed, assigned structured-call ingestion; no carrier dialer |
| `lib/telephony*.mjs`, `scripts/android-relay.mjs` | Approved real-device SMS jobs/receipts, assisted dialer and optional trial-provider Hindi bot |
| `lib/speech*.mjs`, `scripts/speech_service.py` | Paired local Whisper recognition, signed review drafts and approved-note provenance |
| `lib/sim-call-routes.mjs`, `scripts/sim-call-worker.mjs`, `bridge/asterisk/` | Disabled-by-default prepared Linux Bluetooth/SIM voice path with consent and factual receipts |
| `lib/grounded-reports.mjs`, `lib/report-routes.mjs`, `n8n/` | Computed evidence snapshots, strict model-plan validation, reviewed reports and signed n8n orchestration |
| `lib/realistic-cohort.mjs`, `lib/data-quality.mjs` | Reference-informed synthetic histories and transparent data consistency/partial-label checks |
| `lib/supabase-auth.mjs`, `lib/supabase-store.mjs`, `supabase/` | Standalone verified sign-in, allowlisted caller-scoped RPC and Postgres policies |
| `db/` and `drizzle/` | Durable demo records and schema migrations |
| `tests/` | Risk-model and API behavior checks |
| `docs/TECHNICAL_WRITEUP.md` | Architecture, methods, evaluation, and limits |
| `docs/REQUIREMENTS.md` | Brief-to-implementation evidence and remaining gaps |
| `docs/SAMARTH_CONTEXT.md` | Official company sources, existing-app context, fictional care-team model and integration boundaries |
| `docs/DEMO_SCRIPT.md` | Five-minute pitch and live demonstration |
| `docs/ACCESS.md` | Owner entry, invitations, scope, and local fixture accounts |
| `docs/SHOWCASE_STATUS.md` | Working behavior, verification boundaries, and service limitations |
| `docs/ANALYTICS.md` and `docs/COMMUNICATIONS.md` | Detailed module contracts and checks |
| `docs/PHONE_GATEWAY.md` | Basic-phone assisted input, signed ingestion contract and actual telephony limits |
| `docs/SCHEDULER.md` | Local processing and the private Supabase background job boundary |
| `docs/TELEPHONY.md`, `docs/N8N.md`, `docs/DATA_REALISM.md` | Actual phone pairing, deferred credit configuration and data/report truth |
| `docs/SAFETY_REFERENCES.md` | Public-health context and limits of illustrative routing thresholds |

Use synthetic information only. Real-world adoption still requires clinical and operational validation, privacy and retention governance, accessibility field testing, and a tested telephony integration if basic-phone delivery is required.

## Round 1 disclosure

The prototype was developed with AI coding assistance (Codex) and open-source software. Team members remain responsible for reviewing and understanding the submitted implementation. Optional language-model report drafts use the configured n8n/Gateway workflow only when those services are enabled; speech recognition can run locally with Whisper. Generated text is grounded in recorded evidence, is held for human review, and is not a diagnosis. Showcase identities and health records are synthetic; reference-informed data uses public synthetic-data distributions and is not evidence of clinical performance. See [data realism and limitations](docs/DATA_REALISM.md) and [third-party context](docs/SAMARTH_CONTEXT.md).

The history development checkpoint passed **310 Node tests**, with the earlier **13 Python speech-service tests**, TypeScript and targeted lint checks also passing. Hosted rollback tests cover history chronology, calendar aggregation, pagination, replay boundaries, recalculation recovery and role scope, alongside the earlier access/RLS, speech provenance, n8n claims/completion, SIM boundaries and Android delivery-job guards. Separately, one actual Gateway model report and one SIM 2 SMS delivery succeeded. None of these checks establishes clinical accuracy or a working autonomous carrier-call bot.
