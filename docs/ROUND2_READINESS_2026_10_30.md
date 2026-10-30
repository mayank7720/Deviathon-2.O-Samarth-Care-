# Round 2 integration checkpoint — 30 October 2026

**Latest update, 31 October:** independent daily/help-text automatic-call controls, the protected scheduler, saved coordinator briefings and a bounded Operations demo window are deployed. The current release is `dpl_5xqixFK6THTEHQH8asdNBoD2qjBZ`. All new settings remain off pending staff/provider/allowance confirmation. 504 automated tests and hosted/production checks passed; physical application-call acceptance and inbound AI answering remain pending. See [the current calling release](CALL_AUTOMATION_2026_10_31.md). Earlier checkpoints below retain their original context.

Website: https://swasthsync.vercel.app/. GitHub remains untouched.

## Ready and checked

- Protected cloud sign-in, four portal routes, account-bound contacts and scoped cloud reads.
- Separate Risk & wellbeing, Health charts, Medication patterns and Weekly AI summaries screens. Daily risk is personal-baseline rules/anomaly scoring; the weekly family draft uses the configured language model. They are not interchangeable features.
- A real n8n model run completed and stored a pending-review draft with eight evidence entries. No family publication was performed by verification. Existing workflow execution-data retention is off.
- The authorised Realme RMX3395, Android 14, is paired over USB. Both local loopback paths and incoming SMS/MMS webhook registrations are present. The receiver's cloud worker is online.
- A fresh lowercase `help` reached the receiver on 30 October at 21:47:26 IST and was durably stored at 21:47:35 IST. It matched S001 and produced a linked care follow-up. Both the assigned coordinator and linked family's gateway messages and cloud jobs reached **delivered**. The request was subsequently acknowledged in the website. Carrier delivery does not prove a person read the SMS or completed a follow-up.
- The installed offline faster-whisper base transcription service is running on the paired laptop. It is a recording/transcript review feature; it does not give the USB phone live telephone audio.
- Active Twilio Trial credentials and caller configuration are installed privately in Vercel and Supabase Vault. Paid-account calling remains blocked. No new number purchase or top-up occurred.

## Changes in this checkpoint

Website call dispatch now delegates to the existing signed, JWT-protected worker. The worker rechecks the saved job, current recipient, current care assignment and calling hours. Its database capability stores provider outcomes; browser clients cannot forge a terminal rejection to unlock a redial.

A definitive provider/client rejection or pre-call validation failure records a failed, incomplete check-in with zero invented answers. A timeout or provider server error records an uncertain submission, with no automatic redial. Provider error text and phone numbers are excluded from error messages; only a bounded code and authored guidance may be shown. Current calling hours are 08:00–20:00 IST.

Later SMS delivery-report polling runs separately from the alert queue check. A missing handset receipt no longer holds the next senior's alert for the two-minute polling window. Each send still uses its saved provider ID and consent-bound lease; no second SMS is sent to obtain a receipt.

Phone intake, SMS questionnaires, speech status and telephone operations now avoid rebuilding the cohort's clinical score cache. Telephone actions read only their own jobs, reviews and current contacts; senior existence and consent are loaded only when an action needs them. The contact reader narrows account/profile candidates before applying the existing caller and recipient checks. A rollback comparison returned identical permitted contacts for every existing account. The measured database lookup improved from 6,815 ms to 13 ms; this is query timing, not a page-load guarantee.

Interrupted SMS receipts can be reconciled for 24 hours while the phone request remains open. A signed receipt-only claim renews an expired lease, releases no destination number, and instructs the receiver to GET the original gateway message ID. It cannot enqueue a message, change its text or move delivery backwards. This recovered the real family alert after its saved contact was edited, and the coordinator's later delivery receipt. Normal new sends still require the current contact and consent. Both successful renewal and blocked household/content-change cases were checked in rolled-back database transactions.

The notification/intake delivery label now follows each guarded SMS job receipt immediately. A projection-only backfill aligned older cached labels with existing gateway-backed job evidence. At 22:19 IST the fresh request's coordinator display and linked family route both read `delivered`; the receiver's cloud worker and installed speech service were healthy. No additional SMS was enqueued by receipt recovery or this display repair.

Double-click **Start Showcase Services.cmd** in the project folder to pair/register the existing phone, reuse or start the SMS receiver, and reuse or start local transcription. It does not dial, download a model or change billing. Keep the laptop, USB phone and SMS Gateway online. The public website itself runs independently in the cloud.

## Remaining acceptance and configuration

| Item | Exact status |
|---|---|
| Coordinator SMS | Fresh physical HELP produced matching gateway/cloud `delivered` receipts. Reading the SMS and completing the human follow-up are separate actions. |
| Family SMS | Confirmed family contact is SMS-ready; the HELP family's notice reached gateway/cloud `delivered`. Receipt recovery sent no duplicate message. |
| Operations backup | Cloud check still finds no saved Operations mobile or SMS permission. Configure that person's own number and channel permission for a usable fallback. |
| Real Twilio call | A 38-second console sample call reached the Realme helpline. Application bot calls to the intended senior/family/staff numbers still require trial verification and physical acceptance within calling hours. |
| AI Call Bot | Deployed Hindi/English speech recognition and local NLP with keypad fallback. Senior health questions and family/staff care notices are separate. Physical application-call acceptance remains pending; this is not an open-ended LLM conversation. |
| n8n failure branches | Published through the authenticated management API as version `6a902873-d31c-484c-a082-b533ab323e0e`; four bounded failure branches and all four no-saving settings verified. A fresh public-site request completed and stored a genuine review draft. |
| Two-way SMS check-ins | Cloud implementation and receiver tests pass; one real outbound question plus a matching physical reply still needs acceptance. |
| RCS | Ordinary SMS works. The separately selected official Google RCS test agent is not configured. |
| Automatic weekly LLM batches | Not enabled. Generation is explicitly requested and reviewed, within remaining credits. |

No diagnosis, prediction of a named condition, medicine-change advice or guaranteed emergency dispatch is claimed.

## Validation and release

- **494 automated tests passed**, including the actual receiver process with intercepted upstream calls; targeted ESLint passed. The Vercel production build completed successfully.
- Production release: `dpl_EVP3UPrzTHxm6fahFedzRqxHjzJR`, promoted after protected-stage page, authentication, monitoring, stored model-result and configuration checks.
- Runtime package: 282 source files; SHA-256 `e663f9a8845aa8719c6bea57272553fe1e8f0671b0be8443652af9667874f27a`. Base Git commit `edbcde91927bc243c57c3eee6cff600609f7dd7d`; reviewed uncommitted changes were deployed directly. No GitHub push or commit was made.
- Installed contact and receipt migrations retain existing private-function grants and RLS. Security advisors retain the existing public-extension/leaked-password-protection warnings and intentionally closed-table informational findings; no new security finding was introduced.
- Canonical public page/link and signed-in API verification is recorded in the local release checks. A real n8n report is read back without starting a new model run or publishing it to the family.
- Final public checks passed for sign-in, 7/30/90-day risk and medication views, saved genuine LLM output and trial-call configuration. The new deployment's error-log scan found no errors in the checked five-minute window. Browser visual inspection remains unavailable.

No live phone answer, family consent, closed care outcome or synthetic carrier receipt is fabricated for the presentation. Browser control still reports disabled; the user supplied an n8n API key privately, which enabled the report workflow update without browser automation. The key is used only for management, not runtime report generation.

## Later integration update: reported issues in SMS

The live phone-alert formatter now includes up to two saved, prioritised reported cues, such as breathing trouble, a fall, missed medicine or loneliness. Generic help/callback messages explicitly say the reason is unconfirmed. The formatter ignores free-form labels and raw SMS content; it introduces no diagnoses. Staff receive the identified senior, a callback number, time and next action. Family messages use the existing sharing/channel consent and omit the staff-only caller number. Long/Hindi names use a compact format that keeps the senior ID and one issue within 70 characters; ordinary English alerts remain within 160 characters.

Migration `20261030171251_include_reported_issue_in_phone_sms.sql` is installed. Existing sent/queued message snapshots are immutable; the new wording applies when a new alert is created. The full hosted phone-intake rollback fixture verifies routing, consent withdrawal, blocked forged text, immutable snapshots, both message budgets and issue labels. Forty-two relevant local tests also passed. No extra SMS was sent by these checks. The existing live HELP request produces 134-character coordinator and 128-character family previews with an explicit unconfirmed reason.

The new n8n report acceptance job is `43cc708d-6531-4c32-9ccc-77bef7a8cd70`: actual model `gpt-5-mini-2025-08-07`, eight evidence entries, saved pending review. Twilio verified as an active trial; its usage API initially showed zero calls/minutes and zero recorded Voice usage cost before the later 38-second console sample. That earlier usage reading is not the current remaining allowance. An unknown call callback is rejected and an unsigned n8n callback returns 401. The account did not permit the geographic-permissions API; verified recipient and remaining trial minutes still need console confirmation before a physical call test.

## Latest release: role-bound bilingual speech calls

The current public deployment is `dpl_BL43qasAxJrQQyBsB4S6gQ8NZnUw`, promoted after protected-stage verification. Runtime: 284 reviewed files, SHA-256 `6d269a33e619739cfa04eb6a022976e7daa334ea535913929374a678cd694ca0`. The earlier release IDs above are historical. No GitHub commit or push was made.

Migration `20261030175143_role_bound_bilingual_voice_calls.sql` is installed. `voice-hooks` version 4 and `n8n-hooks` version 9 are active with JWT checks retained. Speech is enabled in both website configuration and the private calling worker configuration. The n8n report workflow and scoring worker were not replaced.

Saved receiving accounts now cover senior, family, coordinator and Operations roles with different permitted purposes. Current number, contact revision, channel consent, care assignment and family sharing are rechecked before dispatch. Optional saved help requests must belong to the same senior and remain open; a coordinator recipient must match their assignment. No destination is replaced with the helpline or another trial-verified number.

Senior speech uses provider transcription plus local assertion-aware cue/intent analysis; Hindi and English prompts and short responses are supported. Low/missing confidence does not produce health answers. Family/staff notice replies are stored as operational acknowledgements, never patient health signals; backup or unavailable staff produce an Operations task. The original care follow-up needs separate human action.

All 498 automated tests passed, followed by 41 targeted checks after wording/configuration refinements. TypeScript, targeted lint and the Vercel production build passed. Both hosted senior-call and four-role routing fixtures passed and rolled back all fictional data. Live checks passed for 14 public pages, 11 linked destinations, all four sign-in choices, protected APIs, 7/30/90-day monitoring, the genuine stored LLM report and the speech-enabled trial setup. No call, SMS or model run was initiated by these release checks.

The 38-second Twilio console sample reached only the helpline. It is not an app bot job. Verify each intended receiving phone in the trial account, then demonstrate consent, speech, cloud storage and the human follow-up within 08:00–20:00 IST. No paid account, top-up, streaming LLM call or proven clinical detection is claimed.
