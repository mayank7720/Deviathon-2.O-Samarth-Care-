# Phone-first care support

The senior's primary route is an ordinary telephone call or a short SMS, not a
website form. The care portal supports onboarding, coordinator response and the
recorded outcome. This is a human callback workflow, not a staffed emergency
dispatch service or a diagnosis system.

## What is implemented

- A saved coordinator telephone contact, optional Operations fallback, vCard
  download and a large-print care card. A senior can dial the saved number on a
  basic phone. The website is not needed for the call.
- A separately labelled SMS helpline on the same card, with HELP and CALL
  instructions and its own saved contact. This is the gateway SIM's number;
  the coordinator's account keeps their own callback and alert number.
- New incoming care SMS from the chosen gateway SIM. Commands accept English,
  Hindi and Hinglish phrases, common spelling variants, case, spacing and
  punctuation. Examples include `please help`, `mujhe madad chahiye`,
  `could you call back` and `मुझे कॉल करो`.
  The receiver checks the gateway signature, then sends
  only care-related new messages to the authenticated care API. It does not
  scan an inbox or export historical messages.
- Plain-text MMS uses the same care flow through the separate `mms:downloaded`
  webhook. Media attachments and messages with unknown SIM metadata are excluded.
  The actual text transport is saved in the analysis, and staff see SMS or TEXT
  MMS. Outbound coordinator alerts remain ordinary SMS.
  RCS is a different protocol and is not supported by the SMS webhook. For the
  demo, force the sender conversation to SMS/text; an RCS delivery receipt does
  not establish SMS delivery. MMS-like gateway metadata alone does not prove
  that the original message used carrier MMS rather than RCS storage.
- Natural messages such as `I fell yesterday`, `saans lene mein dikkat hai`,
  `I forgot my medicines` or `meri tabiyat kharab hai` can request human review
  without a command. Local assertion rules extract evidence and distinguish
  some denials, hypothetical advice, old resolved events and other subjects.
  Assertion rules handle the primary routing. A separate local intent model
  was trained on 26,912 generated examples from 336 authored English, Hindi
  and Hinglish seed phrases in 112 families. Its suggestions are saved for staff
  review. V2 failed its precision/recall release gate and remains in shadow mode:
  it does not add or remove alerts. This is not an LLM or clinical diagnostic
  model. There is no external AI request or inference charge. The rules have bounded
  vocabulary and can miss unfamiliar phrasing; HELP remains the simple fallback.
- The authenticated server recomputes the analysis and saves its version,
  reasons, cues, priority and human next step in the cloud request and dated
  senior note. Clients cannot supply an analysis or select the recipient.
  Staff can see the evidence and review requests in urgency order. This
  request priority is separate from the senior's longitudinal daily risk score.

The model's full failed/successful metrics, abstentions and synthetic-data limits
are documented in [SMS_MODEL_EVALUATION.md](SMS_MODEL_EVALUATION.md). Run
`node scripts/train-sms-intent.mjs` to reproduce the synthetic corpus, grouped
evaluation and compact model. Generated example rows are ignored in Git; the
authored seeds and reproducible training code are source files. Never describe
these augmented examples as thousands of independent patient observations.
- A unique registered senior/family number can select one permitted senior.
  Shared, unrecognised and out-of-scope numbers go to Operations review without
  being attached to a guessed person's clinical history.
- Durable incoming requests, a linked follow-up, dated note evidence, staff-only
  acknowledgement, callback dialer action, recorded contact attempt and outcome.
- A phone-only SMS notification worker. Staff alerts identify the senior by
  name and record ID, state HELP or CALLBACK, and include the incoming number
  and received time in IST. Linked family accounts receive their own notice
  identifying the senior and asking them to check in. Family sharing, an active
  relationship, a confirmed current mobile and SMS consent are required.
  Raw health notes, diagnoses and clinical measurements are excluded from SMS.
  Long or Hindi names use a shorter message with the unique record ID retained;
  each message stays within one conservative SMS segment. Full details remain
  in the secure portal. Existing Android receipts and rate limits still apply.
  The worker does not drain unrelated historical demo alerts.
- Operations escalation after an unacknowledged help request is two minutes old,
  or a callback request is five minutes old. Acknowledged requests and recorded
  contact attempts without an outcome can also escalate after five minutes.
  The escalation check runs once per minute. These are operational review
  thresholds, not response-time guarantees.

Opening a dialer does not establish ringing, an answered call or a conversation.
Carrier acceptance is different from an SMS handset receipt and from human
acknowledgement. A contact attempt does not resolve the support request.

## Local setup

1. Use the updated public website, or start the local Supabase-backed website.
   Configure the private receiver's application URL to that exact origin. The
   public site now has the phone routes; it does not depend on a local web server.
2. Register each senior's own number and the coordinator's number in Operations
   account management. Confirm the recipient and configure call and SMS consent.
   An Operations mobile is needed for a usable telephone fallback. Configure
   linked family accounts' own numbers and SMS permission too, and enable
   senior-to-family sharing only with consent. Missing family SMS configuration
   is retained as `awaiting_contact`; no substitute number is guessed.
3. Keep the USB-authorised Android running SMS Gateway in Local Server mode.
   `node scripts/phone-intake-receiver.mjs --pair` prepares only the local USB
   forwarding paths. It does not install, grant permissions, read messages or dial.
4. The ignored `.dev.vars.phone-intake` holds the gateway signing key and local
   receiver settings. The same key must be saved on the phone under Settings →
   Webhooks → Signing Key. Never commit it or paste it into chat.
5. `node scripts/phone-intake-receiver.mjs --register` adds the new-SMS webhook.
   `node scripts/phone-intake-receiver.mjs` starts the receiver. The existing
   private Android relay file supplies its assigned care login and USB gateway
   credentials. `SAMARTH_PHONE_INTAKE_SEND_ALERTS=true` enables only phone-request
   SMS notifications. The care server requires `SAMARTH_PHONE_INTAKE_ENABLED=true`.
   Set `SAMARTH_RELAY_ROLE` to that account's existing assigned portal role.
   Set `SAMARTH_PHONE_INTAKE_NUMBER` in the care server's private environment to
   the gateway SIM number. The care card shows it only after household access is
   verified. It must not replace the coordinator's personal contact number.
6. In the coordinator or Operations portal, open **Incoming phone help**.

The laptop receiver and paired phone must remain online for cloud SMS intake.
USB forwarding is lost when the phone disconnects. After reconnecting, run the
phone-support launcher again, or run `--pair` while the existing receiver stays
open. Do not start a second receiver on the same port.
The saved direct coordinator number remains the independent telephone path.
Calls to the SMS gateway SIM are not automatically answered or forwarded. A
person would need to answer that handset; automated voice routing is not yet
part of this intake receiver.
Gateway permissions, carrier service and consent still require device testing.
Software has no added SMS API fee; a carrier plan may charge or limit sending.
The existing notification limits can hold repeated SMS; the in-app request stays
visible. Do not present this prototype as a guaranteed emergency channel.

## Acceptance checks

`tests/phone-intake.test.mjs` checks commands, HMACs, dates, SIM filtering,
duplicate physical-message identity, role checks and server-controlled routing.
The hosted rollback fixture checks actual PostgreSQL matching, permissions,
follow-up transitions, selective SMS queuing and escalation without leaving
test accounts or sending carrier messages.

A physical incoming HELP SMS, saved cloud request, coordinator handset alert and
human callback must each be verified separately. Tests and webhook registration
do not establish those receipts. Never fabricate an inbound SMS to suggest a
senior actually contacted the system.

The loopback receiver's `GET /health` reports incoming webhook, rejected,
ignored and stored counts, plus the SMS worker's last successful check and error
stage. It exposes no message text, phone numbers, account names or keys. These
counts reset when the process restarts. A successful worker check does not mean
an SMS was sent or delivered. Expired care sessions are renewed once before an
API retry, with a delay between failed sign-in retries.

`tests/phone-receiver.test.mjs` exercises the actual local HTTP listener and
session renewal with synthetic upstream responses in an isolated directory.
It never contacts the cloud, reads private relay settings or sends carrier SMS.

Two-way scheduled wellbeing questionnaires, an automatic missed-call detector,
autonomous AI carrier calls and voice transcription are separate capabilities.
The SMS understanding does not establish those integrations. Neutral texts and
an “I am fine” message do not clear alerts or complete a scheduled check-in.

India's official emergency contact is [112](https://www.india.gov.in/directory/helpline).
The phone card includes it as a direct telephone action; the app does not call it
automatically. SMS Gateway protocol reference:
[official webhook documentation](https://docs.sms-gate.app/features/webhooks/).
