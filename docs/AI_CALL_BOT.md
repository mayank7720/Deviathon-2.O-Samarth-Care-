# AI Call Bot

> Current showcase decision (31 October 2026): **under development and excluded from the live demo**. Setup is paused. The implementation below describes prepared capabilities; physical end-to-end application-call acceptance has not occurred.

Open **Communication → Calls & SMS → AI Call Bot** on https://swasthsync.vercel.app/.

## Automatic calling controls

The **Automatic AI calls** section on the same page adds two separate per-senior controls:

- **Daily AI follow-up:** one agreed Hindi/English call per day, with up to four wellbeing questions.
- **AI callback after a senior’s help text:** a short clarification call for a new, matched HELP/urgent SMS from that senior's registered number. Routine callback texts, family-originated, historical, delayed and ambiguous/shared-number texts do not automatically enrol a senior.

After a senior call ends, the assigned care owner receives a separate briefing call with the senior reference, supported source cues and the actual structured result. Failed, unanswered or unclear calls still produce a briefing with unknown information left unknown. Family/staff replies never become senior health signals. An acknowledgement does not resolve the original request. An unacknowledged briefing creates Operations review through the existing care-inbox notification route; this release does not automatically phone Operations as a second escalation stage.

All settings start off. Operations must arm the shared control and confirm the remaining free-trial minutes in the provider console. A new sequence needs eight unreserved minutes, reserving four per call. The check expires after 24 hours. Manual calls created after that check also count against the available allowance. Reconfirmation counts pending calls conservatively. Five-call rolling-day and one-active/uncertain-call limits remain. No top-up, paid account or automatic redial is permitted.

Only senior profiles with active login bindings or existing settings appear in the selector. Assigned staff must confirm current voice/speech consent and trial verification for both the senior and care owner. Number/assignment revision changes invalidate saved automation until staff reviews it. The worker rechecks current account permissions before every dispatch. A global pause cancels undispatched automatic sequences; it cannot recall a carrier call already in progress.

Operations manages **Calling controls** on the same page: pause all new bot calls, choose an agreed daily window in IST (including overnight windows), allow all-day access, and separately allow HELP callbacks and their coordinator briefings outside routine hours. The saved policy applies to both staff-started and automatic calls. These settings do not enable a senior's automation or bypass account, consent, allowance, single-caller, daily-cap or trial-only checks. The installed default is 08:00–20:00 IST; there is no requirement to use a fixed two-hour showcase window.

The hosted scheduler checks due work once per minute. It uses a private scheduler credential plus Edge JWT protection and the existing signed voice dispatcher. n8n's monthly workflow allowance is not consumed by a minute-level polling workflow. Daily slots do not replay before their enable time. Jobs and leases are saved before dispatch, with one unique daily/source key. Unknown provider submissions stay uncertain and require human review, rather than triggering another call.

Settings, runs, per-stage carrier outcomes and saved timeline entries live in Supabase behind scoped RPCs. The portal shows reasons for holds, the senior's actual summary and the coordinator response. A synthetic hosted rollback fixture verifies the complete planning and outcome sequence without placing real calls. Physical application-call acceptance remains pending; see [the automation release](CALL_AUTOMATION_2026_10_31.md).

## Receiving the right call

Staff select a saved receiving account, its language and, optionally, an existing help request. The server resolves that account's current permitted mobile number immediately before dispatch. Changing the mobile, withdrawing call consent, removing family sharing or changing the care assignment invalidates an old request. A Twilio-verified helpline never replaces a different person's destination.

| Receiving account | Conversation | Recorded outcome |
|---|---|---|
| Senior | Up to four wellbeing, medicine, food/sleep and human-support questions | Partial or complete senior answers and reported cues; help stops the questions and requests human attention |
| Family member | Consented care update with the senior reference and saved reported issues | Acknowledgement, request for care-team contact or unavailable response |
| Care coordinator | Assigned senior's care notice and request to review or arrange backup | Staff acknowledgement or an Operations follow-up |
| Operations manager | Care notice and escalation review | Administrator acknowledgement or a saved Operations task |

Family and staff answers never enter a senior's clinical signal history. Acknowledging a notice does not complete the original care request. Source requests must belong to the same senior and remain open; a coordinator must be the request's current assignee.

## Hindi and English speech

The bot speaks and recognises **Hindi (`hi-IN`) or English (`en-IN`)**, selected before calling. The first consent question requires the keypad. No health or care-detail question is asked before the intended recipient agrees. `2` at consent means another person answered; `9` declines.

After consent, provider speech recognition supplies text and confidence. Local assertion-aware NLP, using the SMS understanding pipeline, interprets short senior answers and reported health cues. English, Hindi and supported Hinglish phrases are understood. Confident spoken numbers and keypad choices remain available. This is guided speech interaction, not an open-ended LLM telephone conversation or a diagnosis model.

Missing or confidence-below-0.75 speech is not accepted as a health answer. Unrecognised answers trigger a clarification; two unsuccessful attempts end that step as incomplete. Negated and hypothetical concerns are not treated as current symptoms. Supported reported concerns, incomplete answers and requests for a human are stored separately. `0` requests human contact and `9` stops. No condition or medicine change is prescribed.

Consent discloses speech processing by the telephone provider. No call recording is requested. No patient history or transcript is sent to an external LLM. Role notices contain a bounded senior reference and supported reported-issue labels, not the raw incoming message. Use fictional answers for the showcase.

## Storage and routing

The website saves an immutable role, account contact, language, purpose and optional source request. A signed request reaches the JWT-protected Supabase calling worker, which checks the job, current access, mobile, consent and calling hours again. Signed Twilio callbacks bind the public URL, saved call ID and token. Revision checks prevent duplicate answers and stale state updates.

Senior summaries contain only actual answers/cues and are labelled `llmUsed:false`; the separate **Weekly AI summaries** feature is the LLM-based report. Senior help/change/missed check-ins create guarded follow-ups using existing consent-bound coordinator/family notification routes. Family contact requests go to the responsible care team; staff backup/unavailable outcomes go to Operations. Human review remains separate from the call and original follow-up.

Carrier `completed`, recipient consent, question completion and completed human care are separate facts. Provider failure before connection records no health answers. An uncertain submission is never automatically retried.

## Free-trial limits and acceptance

- Only an active Twilio Trial account is allowed. Each receiving number must be verified in that trial; the saved app mobile must still be that person's own intended number.
- Manual calls are explicitly saved, then started. Automatic calls require the separate enabled settings and Operations allowance above. Neither route permits automatic redial, number purchase or paid-account calling.
- Application limits: the Operations-managed calling policy; four minutes per call; five showcase requests per day; one active or uncertain call at a time.
- Trial minutes, recipient allowance and destination availability remain controlled by Twilio. Do not upgrade or add paid credit for this showcase.
- The verified **38-second console test** reached the Realme helpline. It proves provider transport only. It was not an application bot job, a senior check-in or proof that other recipient numbers are verified.
- Automated role/speech/callback tests and hosted rollback routing tests pass. A physical application call covering answer, consent, speech, saved result and human follow-up still needs acceptance within calling hours, after verifying the intended receiving phone. No such call is fabricated in testing.
- The optional n8n voice-dispatch template is not required or activated. The protected website-to-worker route handles calls; the live n8n workflow generates weekly AI report drafts.

The separate prepared Linux/Asterisk bridge and USB SMS relay do not provide this trial provider's live call audio. The SMS helpline remains a distinct receiving service.

Primary references checked 30 October 2026: [Twilio Voice trial](https://www.twilio.com/docs/usage/trials/try-out-voice), [Gather speech and keypad input](https://www.twilio.com/docs/voice/twiml/gather), [Call API](https://www.twilio.com/docs/voice/api/call-resource). Trial speech is turn-based; streaming/ConversationRelay is not available on this trial route.

## Verify the showcase phones

In Twilio's **Try out Voice → Start a call → To → Add a verified tester**, add the saved senior phone and then the saved coordinator phone. Each owner enters their verification code directly in Twilio. This is a one-time restriction of the free trial (up to five testers), separate from recording consent in SwasthSync. Do not change a person's app number to the helpline just because the helpline is already a tester.

Select each verified recipient in Twilio and check its displayed **From** caller. Twilio notes that the trial caller can vary by recipient. Confirm the configured application caller matches before attempting a bot call. Console sample calls only prove carrier transport; application acceptance also requires a saved app call, signed callbacks, recipient consent, actual answers and the resulting care-team follow-up.

If the trial refuses an unverified destination, stop and verify that person's own phone. Do not upgrade, purchase a number, substitute another recipient or automatically retry a rejected/uncertain call.
