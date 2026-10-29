# Earlier showcase scope and verification

**Historical record for the preceding local/Supabase batch.** The public-website, reference-informed data, evidence-locked reports, n8n, Android SMS and foreground motion expansion is described in [DELIVERY_2026_10_29.md](DELIVERY_2026_10_29.md). Its final deployment result supersedes the earlier version-2 status below. The 93.7% precision figure below belongs only to the legacy authored stress test and is not a current clinical or reference-informed-mode claim.

This file describes the source's behavior and acceptance boundaries. The final delivery message records the latest test, build, browser and hosted-deployment results. A source implementation or mocked test does not by itself establish a live microphone connection or production medical readiness.

## Deployment checkpoint

The previously published **version 2** is the last verified hosted version. The user requested local completion of this expansion after the connected Sites account returned project-not-found and an empty site list. The expanded access, analytics and communications source below is delivered locally. Hosting is unchanged; no replacement Site was registered. Do not assume the existing live URL contains this expansion until a later deployment is confirmed.

## Implemented behavior

| Area | Behavior |
| --- | --- |
| Core care workflow | Daily risk queue, personal-baseline comparisons, reasons, suggested action, signal entry, care tasks and outcomes |
| Triage and missing data | Immediate concerns sort ahead of ordinary numeric scores; insufficient observations and baseline warm-up show unknown/null; falling BP changes remain reviewable |
| Data and model | Seeded 200-person, 90-calendar-day cohort; 17,645 observed records; rules plus local Isolation Forest; bilingual cue extraction |
| Detailed analytics | Nine domains, supported weekly extractive summary, data quality, dose patterns, submitted sensor rules, descriptive three-day projection |
| Alerts | Daily deduplication, acknowledgment, outcome-based resolution, nonurgent snooze/cooldown, urgent bypass and reopening on new urgent evidence |
| Learning supplement | Local logistic usefulness classifier after sufficient labels and viable senior-group holdout; never lowers clinical urgency |
| Hosted access | Public landing; protected APIs require verified identity and active assigned membership; email-bound invitation and revocation |
| Standalone Supabase | Verified email/password authentication with server cookies; caller-scoped Postgres RPC and RLS; explicit safe cached family/senior payloads |
| Family privacy | Linked senior scope and current consent checks for records, summaries, alerts, messages and voice signaling |
| In-app messages | Authorized persistent inbox with separate recipient read state; no email delivery |
| Daily delivery | Inspectable replay/live clock, stored daily scores, serious/weekly outbox, consent and membership rechecks, bounded retries and explicit generic browser-push enrollment |
| Operations timing | First recorded alert acknowledgment and task completion measured separately; missing historical lifecycle times stay unavailable |
| Phone/SMS showcase | Explicit simulation, Hindi/English four-question keypad flow, persisted answers and follow-up requests |
| Phone input gateway | Assigned senior list, HMAC signature over exact body, timestamp tolerance and durable nonce identity for structured answers; no carrier dialing |
| Browser voice | Actual two-party WebRTC path with explicit microphone permission, protected signaling, expiry and cleanup; no recording/transcription |
| Optional speech | On-device recognition and installed local read-aloud voices; text fallback, no remote recognition fallback |

## Reproducible evaluation

`npm run evaluate` writes dataset and metrics under ignored `outputs/`. The high-priority threshold is 60; evaluation uses 50 seniors held out from forest fitting and 3,000 senior-days. Daily precision is **93.7%**, recall **74.2%**, F1 **0.828**, and confusion counts **TP 89 / FP 6 / FN 31 / TN 2,874**. Two unknown senior-days remain in the denominator as unflagged. All **10 held-out planted episodes** are detected. Detection averages **3.1 days after planted onset** and **4.7 days before a synthetic escalation deadline**; the deadline is not an observed acute event. Episode detection and daily recall measure different things.

The same-split rules-only comparison reports precision **92.8%**, recall **64.2%** and F1 **0.759**. Six seeded/phrase-variant runs produce precision **92.2–93.9%** and recall **73.3–79.2%**. Per-pattern results and eight transparent language probes are included. These generator variants and authored phrases are robustness checks, not a blind language dataset or independent patient validation.

These are synthetic-pattern results. No external clinical benchmark, prospective trial, validated physical fall detector or disease predictor is claimed. The projection's residual envelope is descriptive and not a calibrated medical probability interval.

## Verification commands and evidence

```powershell
npm test
npm run evaluate
npm run build
```

Automated checks cover model behavior, synthetic reproducibility, multilingual evidence, API validation, verified membership/scope/consent, analysis, alert state, communication simulations, signed phone input and mocked voice lifecycle. Supabase checks must additionally verify direct database policies, safe-payload redaction and immediate revocation; mocked Auth tests alone are insufficient. Current counts and final execution outcomes are updated by the delivering agent; this file intentionally avoids a frozen test count.

Browser QA should verify the landing, assigned entry, invitation states, coordinator signal/task workflow, analysis, alert resolution, family consent denial and mobile layout. Real audio acceptance needs two distinct authorized accounts, secure browser contexts, explicit microphone permission and a compatible network. Mocked WebRTC tests do not establish actual microphone quality, NAT traversal, or two-device audio.

## No paid service requirements

The source uses no paid AI model, hosted inference key, SMS/PSTN account, STUN server or TURN relay. Local running and application inference do not require those services. Browser push uses application-generated VAPID keys, an explicitly subscribed browser and that browser's push service; service acceptance does not prove human receipt. Notifications carry generic text only. Browser audio uses `iceServers: []`; same-network peers are the intended showcase setup, and some networks cannot connect. Installed on-device speech availability varies by browser, operating system and language.

This does **not** guarantee free hosting indefinitely, sufficient quotas on every plan, free telephone delivery or operation at 10,000 seniors. Hosting resources, account limits, cost and scale must be measured separately. SMS and phone simulation states never imply a real delivery receipt.

## Remaining real-world work

Clinical and operational review, representative-data validation, alert-fatigue studies, accessibility field testing, retention and incident governance, actual device integrations, optional real telephony, and 10,000-person end-to-end model/delivery cost benchmarks remain outside validated showcase coverage. An indexed cached-read benchmark does not establish full scoring throughput or cloud cost. A public landing does not make health records public; protect the identity boundary and preserve existing Site sharing settings.
