# Care review, summaries and trial calling — 30 October 2026

Production: https://swasthsync.vercel.app/. No GitHub push.

## What each feature does

| Page | Purpose | Method |
|---|---|---|
| Health review → Risk & wellbeing | Explain daily review priority and supported changes | Personal-baseline rules and anomaly scoring; local text cues. Not an LLM report. |
| Health review → Health charts | BP, sugar, oxygen and weight over 7, 30 or 90 days | Saved dated values. Missing values remain gaps. |
| Health review → Medication patterns | Missed-dose chart, repeat timing gaps, medicine-level patterns and a review task | Recorded dose outcomes; missing logs are unknown. No drug-interaction diagnosis. |
| Health review → Weekly AI summaries | Generate, inspect, approve and share a weekly family update | n8n and its configured model select verified statements. The computed alternative is labelled “no LLM”. |
| Communication → Calls & SMS | Account-bound delivery and AI Call Bot | Android SMS relay, assisted calls and trial-provider guided calls are separate channels. |
| Family portal → Weekly summaries | Read an approved update or request one | Unreviewed drafts stay private to staff; active family link and sharing consent required. |

Staff navigation has Daily care, Health review, Communication and Management groups. Duplicate Follow-ups shortcuts were removed. Risk review prioritises flagged changes; usual/unknown domains and methods are expandable. Operations-only administration remains restricted.

## Reliability repair

The live API intermittently returned database timeout code `57014` from `care_events_scan`. Its JSON containment filters and CASE ordering made history reads expensive alongside thousands of gateway heartbeat entries. The replacement uses bound native array predicates and fixed sort direction, plus an owner/time index. It remains `SECURITY INVOKER`; no RLS policy or role permissions were relaxed.

Hosted rollback checks compared old/new filters and pagination, then checked each of the four roles against direct RLS-scoped results. Measured database execution was 8.0–14.5 ms for the tested report/signal read. This measures the query, not full browser load time or a service-level guarantee.

The integration-status endpoint now runs after authorization without loading the cohort. A single senior’s analysis reads that subject’s events and computes their score without rebuilding/writing all cohort cache rows. Temporary database errors are shown as service errors instead of misleading migration instructions.

Migration: `20261030145738_indexed_care_history_reads.sql`.

## Actual LLM check

The published n8n workflow already points its signed claim and callback to the new public origin. Its successful, failed, manual and progress execution-data saving settings were inspected and are “Do not save”. The model node showed $1.99 free Gateway credit before testing.

One new masked synthetic S001 request completed through the live workflow. The cloud holds a pending-review report from `gpt-5-mini-2025-08-07` with eight evidence entries. No approval or family delivery was performed by this verification. The model arranges allowed fact statements; unconstrained invented prose or clinical claims are rejected.

## Trial call setup

The supplied credentials passed the provider’s read-only account check: active Trial. The new trial console exposes a pooled caller number and test recipient even though the legacy incoming-number/caller-ID lists are empty. Its Voice panel showed 75 free minutes. A custom TwiML option is available.

Credentials and trial caller were saved only in the ignored private settings file, Vercel production secrets and Supabase Vault. Trial calling is enabled. No paid account, purchase, top-up or real call was made. Spoken-choice processing stays off; the current bot accepts keypad answers and records no audio.

The public Calls & SMS page must show “Trial calling connected”. Calls still require a saved, consented senior contact that the provider permits as a test recipient. Quiet hours, single active call, daily cap and four-minute limit remain enforced. A physical ring/answer/questionnaire/follow-up test is pending; configuration is not evidence of a completed real call.

## Validation

- 486 automated tests passed; TypeScript, targeted ESLint and production build passed.
- Hosted filter, pagination and four-role RLS checks passed with rollback; security advisors introduced no new findings.
- Live n8n model execution saved a grounded review draft, without family sharing.
- Publication and public-screen verification are recorded below after the staged release passes.

## Published checkpoint

The care-review changes were first published as `dpl_Aa3SUV2tVQ1BbpQXx8fjrgdRu5Wx`. The final phone reliability release is `dpl_EVP3UPrzTHxm6fahFedzRqxHjzJR` at https://swasthsync.vercel.app/. Its 282-file runtime package hash is `e663f9a8845aa8719c6bea57272553fe1e8f0671b0be8443652af9667874f27a`.

The expanded suite now passes 494 tests. Protected staging checks passed before promotion. Public verification checks 14 pages, 11 linked destinations, four login pages, invalid-route handling, redirects, protected APIs, the 7/30/90-day monitoring windows and the stored genuine LLM draft. Browser visual inspection is still unavailable; these are response and API checks.

See [the Round 2 integration checkpoint](ROUND2_READINESS_2026_10_30.md) for actual physical HELP/coordinator/family delivery evidence and remaining call, n8n, Operations contact and RCS acceptance gaps. GitHub has not been changed.
