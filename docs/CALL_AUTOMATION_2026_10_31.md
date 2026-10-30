# Automatic calling release

Prepared 31 October 2026 for https://swasthsync.vercel.app/. No GitHub commit/push, carrier call, SMS or new model run is initiated by the release checks.

## What changed

Calls & SMS has two independent senior settings: daily AI follow-up and help-text AI callback. Both start disabled. The shared Operations control starts paused with zero confirmed trial allowance. Eligible saved senior and care-owner accounts, explicit consent and provider-verification attestation are required before arming a setting.

Daily calls use the existing four-question Hindi/English speech/keypad bot. Help-text callbacks ask one short clarification. The senior can request a person, stop or report help. Missing or uncertain answers remain unknown. Once the senior carrier call terminates, a separate care-owner briefing uses only that run's saved structured answers/cues and the original permitted issue. No raw note, arbitrary model instruction or unconfirmed diagnosis becomes briefing content.

The source text still creates the existing care request/SMS alerts immediately; it does not wait for the AI callback. Failed senior calls still lead to a briefing. A failed/unacknowledged care-owner briefing requires Operations review in the care inbox. An acknowledgement ends the call sequence, not the human care case. Official emergency-response and ambulance services are outside scope.

## Cloud processing and limits

- Migration `20261030191012_call_automation.sql` creates private settings, control, run and timeline records, narrow staff/service RPCs and the minute-level hosted scheduler. No contact is automatically enrolled.
- `call-automation` Edge version 2 uses JWT protection plus a private Vault scheduler key. `voice-hooks` version 5 and `n8n-hooks` version 11 support the updated conversation. The report workflow and scoring-worker version are unchanged.
- Daily/source uniqueness, saved jobs, a two-minute lease, revision checks and the existing single-caller lock prevent repeated scheduler ticks from posting another carrier request.
- The current number, care assignment, source status and voice permission are rechecked before dispatch and details-bearing turns. Shared/service-number arrangements require human review. Phone and assignment changes require review/re-enablement.
- Operations enters actual remaining free-trial minutes, 0–75. A new sequence needs eight unreserved minutes, and each new call reserves four. Manual jobs after the check count too. An allowance check expires in 24 hours. This is a conservative local reservation, not a provider-reported live balance.
- Calls remain limited to 08:00–20:00 IST, five bot requests per rolling day and one active/uncertain outgoing call. An expired slot, missing allowance, cap or uncertain submission appears as a hold/review reason. No paid fallback or automatic carrier retry is added.
- Migration `20261030192111_bounded_call_demo_window.sql` adds an Operations-only, two-hour automatic-call demo window, disabled by default. It requires arming with a newly confirmed allowance and applies only to explicitly enabled, verified/consenting participants. Expiry restores normal hours. Manual calls and every other guard remain unchanged; the client cannot supply its own expiry.
- Pausing cancels undispatched automatic jobs and records the cancellation. A carrier-accepted call may still finish. Submitted results remain visible in the normal call history and automation sequence.
- Only received texts after the setting was enabled and with at most five minutes of delivery delay qualify. Historical/family/ambiguous SMS still follow the existing staff-review path without an automatic senior call.

## Verification

504 automated tests passed, plus TypeScript and targeted ESLint. New tests exercise independent settings, role denial, recipient/time override rejection, scheduler authentication, single dispatch, short bilingual clarification, grounded coordinator briefings, demo-window bounds and uncertainty handling.

The hosted rollback fixture passes for saved settings, exact senior/owner phones, one daily slot, repeated ticks, a real-outcome-shaped senior-to-owner sequence, failed senior briefing, unacknowledged owner review, consent withdrawal, stale contact version, missing allowance, after-hours holds, unknown submission, pause cancellation and historical/delayed/family exclusions. All fictional users, private controls, outcomes and jobs roll back. No synthetic carrier receipt is retained as a real delivery.

Security advisors show the existing pg_net/public-schema and leaked-password-protection warnings. The four new private tables intentionally have RLS enabled and no direct client policy/grant; checked RPCs supply access. The corresponding informational findings do not justify opening those tables.

Website deployment and public post-deploy results are recorded in the local release receipt after promotion. Actual application bot answer, speech, saved result and human follow-up still require a consented physical test within the allowed window, with provider-verified receiving numbers and confirmed allowance. The earlier 38-second console sample was provider transport to the helpline, not that application acceptance.

The promoted website release is `dpl_5xqixFK6THTEHQH8asdNBoD2qjBZ`. It contains 288 reviewed runtime files, SHA-256 `26703f878487f69990f389a2d684b788dc4829323744efa4ce1398e5ded53782`, based on unchanged Git HEAD `edbcde91927bc243c57c3eee6cff600609f7dd7d`. Public checks passed for 14 pages, four sign-in routes, protected cloud APIs, 7/30/90-day monitoring, the stored actual model report and paused-by-default automation settings. The hosted worker rejected an invalid scheduler key after Edge JWT verification. Sixteen observed scheduler executions had zero failures while paused; no calls/runs were created. The checked five-minute deployment error-log window contained zero returned errors. This is observed verification, not proof of carrier acceptance. Browser UI access still reports disabled, so no new visual browser acceptance is claimed.

## Portal setup

1. Under Accounts, confirm the senior's own mobile and the assigned care owner's own mobile, voice permission and current assignment.
2. Verify those intended receiving phones in the Twilio trial. Never replace one person's number with the helpline to satisfy trial verification.
3. In Calls & SMS → Automatic AI calls, select the senior, language and daily time. Enable daily follow-up, help-text callback or both, and confirm consent/verification before saving.
4. Operations checks the current free allowance and arms the shared control. This user action is required to prevent surprise enrolment or spending an unknown allowance.
   For an agreed after-hours demo, explicitly select the two-hour showcase window in the same control. Keep the provider-verified demo participants informed; do not use this as a claim of 24-hour staffing.
5. Observe the saved automation timeline and separate call outcomes. Record the actual human contact and resolution through the normal follow-up controls.

At 19:37 UTC on 30 October, Operations' paused cloud control was updated to the user's reported 74 remaining free Voice minutes. No setting was enrolled and no call was placed. A fresh authenticated provider read confirmed the account is a Trial. Its legacy OutgoingCallerIds collection was readable but empty; that collection does not establish the modern trial tester list, so receiving-phone verification remains unknown. The one-time recipient OTP requirement is imposed by the provider's trial; the application selects saved account numbers automatically for each eligible sequence.

## Still separate

Inbound AI answering and missed-call capture are not added by this release. A call to the Realme SMS helpline rings that handset. Automatic calling remains outbound. RCS, official emergency dispatch, continuous background fall detection, clinically validated early prediction and a proven 10,000-senior cost model are not claimed.
