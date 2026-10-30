# Two-way wellbeing SMS check-ins

Staff access: **Phone support → SMS check-ins**. The current deployment origin is https://swasthsync.vercel.app/.

This is separate from unsolicited HELP/CALL SMS and the four-question website check-in. It asks one wellbeing question through an ordinary SMS, with three explicit answers. It does not diagnose, change medicines or clear existing concerns.

## Workflow

1. An assigned coordinator or Operations chooses the senior, English or Roman-script Hindi, a send time in India time and a 2/4/8/24-hour response window. They confirm permission. The database resolves a single active senior account's confirmed SMS-enabled mobile; the browser cannot supply a destination or arbitrary message text.
2. The question, reference, destination snapshot and schedule are saved to Supabase before dispatch. One open question per senior, a 15-minute per-phone cooldown and a ten-check-in daily cap per phone limit repeated sends. Scheduling also counts existing telephone jobs for the selected account contact. New questions send only between 08:00 and 20:00 IST.
3. The paired Android relay claims a short lease. A fixed message is sent through the existing SIM. A lost submission response is checked using its saved provider message ID; recovery of a previously attempted question only polls the provider and cannot enqueue a replacement blindly. No phone calls are placed.
4. The senior replies `1` (okay), `2` (please call) or `3` (need help). A shared number must include the six-character question reference, such as `AB12CD 2`. The reference alone does not identify an account or grant access. Current account bindings are rechecked.
5. A matched answer becomes a dated note. Callback/help answers create one assigned follow-up; current account-bound coordinator alerts and consented family notices use the existing routing system. First answers remain immutable. Late or changed answers create a separate human review task rather than silently replacing them.
6. A minute-level cloud timer creates one contact task when the reply deadline passes. A sending failure or changed contact creates a contact task as well. Unanswered means **unknown wellbeing**, not a missed dose or a diagnosis. Marking a question reviewed does not complete its linked care tasks.

## Delivery versus response

`queued → processing → accepted → sent → delivered` describes transport only. Gateway acceptance, sending and handset delivery remain distinct. None proves reading, understanding or a human reply. `answer`, `answered_at`, reply records, review outcomes and follow-up IDs are stored separately.

The receiver verifies the gateway signature, selected SIM, event identity and event time before classification. Questionnaire syntax is deliberately narrow. Before forwarding a numeric answer or STOP, the relay checks a masked sender hash against scoped care contacts/recent questionnaires. Unrelated numeric personal SMS from unknown numbers stays on the device. Unsolicited HELP and health concerns retain their existing Operations matching route.

Duplicate physical receipts return their durable saved receipt. Repeated identical answers do not create more signals or tasks. A changed, late, unstarted, cancelled or re-bound question is not treated as a current answer. Staff cannot see another coordinator's questions. Operations can record the review of unresolved attribution without assigning a guessed senior.

`STOP`, `UNSUBSCRIBE` and `बंद` remove SMS permission from the matched account contacts and cancel undispatched questions. They never enable a channel or change account access. Re-enabling SMS requires the normal account consent process. In-flight carrier messages cannot be recalled.

## Setup and limits

- Requires the installed `two_way_sms_checkins` and `sms_checkin_read_efficiency` migrations, current website code and current `scripts/phone-intake-receiver.mjs` running on the paired laptop.
- The ordinary-SMS gateway, Android phone, USB link, laptop and internet must remain available. This is not an always-on carrier platform or RCS agent.
- Relay software adds no SMS vendor fee. The SIM's actual plan, balance and limits still apply. Hindi prompts use Roman script to keep the message within one ASCII SMS segment; incoming Hindi digits are accepted.
- Scheduling the question authorizes the saved send. Deployment/tests do not create real prompts automatically.
- Read-only relay queue/eligibility checks verify the signed request without writing a nonce row every polling cycle. State-changing claims, receipts and replies retain nonce deduplication and durable event identity.
- Hosted rollback tests use fictional numbers/users, simulated delivery states and temporary records. They prove persistence and routing logic, not carrier delivery. A real outbound question and the senior's real reply still require physical acceptance before claiming this feature demonstrated end to end.

## Validation

`tests/sms-checkins.test.mjs` checks the protocol, roles, recipient override rejection, signatures, server-side parsing and gateway opt-in. `tests/phone-receiver.test.mjs` starts the actual local listener against intercepted upstreams, including masked eligibility and session renewal. `tests/sms-checkins-hosted-rollback.sql` tests the installed cloud functions in a rolled-back fixture transaction, including duplicate events, shared phones, permission changes, family routing, monotonic receipts, quiet hours, overdue tasks and opt-outs.

No GitHub push is part of this release. The existing scoring algorithm and daily worker version are unchanged.

## Published checkpoint — 30 October 2026

- Vercel release: `dpl_GjtvNkLt4XvAwWjdX7LW3HqqhpwK`, live on https://swasthsync.vercel.app/.
- Reviewed runtime source: 271 files; SHA-256 `079bbfb4401ea98ea920de76a36872d314bc5337078c6a4cdcadaf714424b276`.
- Verified production login/cookie protection, questionnaire cloud read, signed queue/eligibility, recipient-override rejection, and existing HELP/monitoring compatibility. No new question, real SMS, call or LLM request was created by these release checks.
- Cloud timer enabled; a scheduled run succeeded. The local receiver was restarted and confirmed connected on both loopback addresses with successful cloud checks.
- All 472 automated tests passed, along with the Next.js production build, targeted lint and hosted rollback checks. The real listener's simulated outbound/recovery tests also passed without a carrier call or SMS.
- Browser control remains unavailable, so fresh visual screen acceptance is not claimed. Physical questionnaire acceptance also remains pending.
