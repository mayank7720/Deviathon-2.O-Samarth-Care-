# SMS release — 30 October 2026

Current public site: https://swasthsync.vercel.app/

The release evidence below predates the completed [domain migration](DOMAIN_MIGRATION_2026_10_30.md). Old Vercel addresses have been retired.

Production deployment: `dpl_5rWr97KscvZHETdF1PqBDxjpPj26`, READY, Mumbai, existing basic build resources. Source digest: `7c20cf764d00e1dca2413031b506430590582d8f06f4e0e886e6afabda3c8c74`.

The release is a direct source upload of the tested working tree based on `df83e3c97e3c65e47e313f8c1dc503dd69ccfb8d`. It is not that unchanged Git commit. The first attempt inherited a Git author and was blocked by Vercel's team rules; an owner-account upload from a clean source folder succeeded. No team permissions or protection settings were relaxed. No GitHub commit or push was made. The development remote was checked over HTTPS and had no newer commits at that check.

## Released

- Incoming phone-help staff queue, authorized care contacts and printable phone cards.
- Protected text intake, deterministic senior/household matching, follow-up actions, saved outcomes and minute-based Operations escalation.
- English/Hindi/Hinglish command variants, assertion-aware cue evidence and saved trained-model suggestions. The intent classifier remains in shadow mode after failing its synthetic-data release gate.
- Incoming SMS and plain-text MMS support. MMS attachments and unknown SIM metadata are excluded. Transport is saved in analysis and shown to staff.
- The cloud receiver flag and helpline number are configured in Vercel production. Existing authentication, bridge credentials, n8n settings and family consent remain in place.

## Verification

Both staged builds passed real Supabase staff sign-in, Secure/HttpOnly/SameSite=Strict cookie checks, the authorized phone queue, household contact retrieval, rejection of unsigned intake/outbound requests, an actual gateway health probe and a signed bridge heartbeat. The first release also passed those authenticated checks on the public alias. Anonymous public home/auth return 200 and the protected queue returns 401 without Vercel protection bypass.

The pre-release regression suite passed 455 tests. The subsequent SMS/MMS and local-receiver changes passed 22 targeted tests and lint; Vercel's final build/type checks passed. This is not a claim that the full suite was rerun after the final MMS change.

The receiver now targets the public HTTPS API and listens only on IPv4/IPv6 loopback. Its signing key was synchronized privately with the gateway. Local-only callbacks do not wait for the phone's internet connection. Gateway receive permissions were inspected, not changed. Gateway restart and Start Service were performed; a direct phone-to-laptop TCP probe succeeded. An earlier HTTP/netcat probe closed too soon and was not evidence that USB forwarding failed.

## Real phone acceptance: intake and carrier send verified

After the user disabled RCS on the sending phone and sent a fresh lowercase `help`, the signed ordinary SMS reached the receiver and was saved in Supabase. Its received time is 30 October 2026 at 11:30:32 UTC (17:00:32 IST). The request matched senior S001, was assigned to the current coordinator, and saved SMS understanding version `sms-understanding-v2` with transport `sms` and model mode `shadow`. Duplicate gateway retries matched the existing saved request rather than creating more help requests.

The resulting coordinator alert reached the Android gateway's `Sent` state, and the cloud notification route also records `sent`. A subsequent direct lookup of that specific outbound message still returned `Sent`, not `Delivered`. Coordinator handset delivery, human acknowledgement and a connected callback remain unverified. The user-triggered help request remains open; no outcome was fabricated. Verification scripts themselves sent no SMS.

The overdue Operations backup route was created but is `awaiting_contact`: a confirmed current Operations mobile number with SMS permission is required. Do not substitute another account's number or enable consent silently.

Earlier gateway logs contained MMS events and the user identified possible RCS use. Those log entries do not prove that the earlier texts were ordinary carrier MMS. RCS does not trigger the SMS webhook and is not made compatible by an AI parser or by text-only MMS support. The separately selected official Google RCS test-agent route is not configured yet and will use its own agent conversation.

The Android phone, USB connection, gateway service and laptop receiver must remain online. The public website itself does not depend on the laptop. The system is a human review/callback workflow, not emergency dispatch.

## Identified staff alerts and family notices

The follow-up database migration `20261030114020_identified_phone_family_notifications.sql` is applied to the existing Supabase project. It updates live cloud routing without requiring a new Vercel build. New automatic staff alerts include the senior's saved name, record ID and request context; phone alerts also include the incoming callback number and received time in IST. New matched HELP and CALLBACK requests create a separate linked-family notice. The notice is sent only to active linked family accounts with current sharing permission and a confirmed SMS-enabled mobile. Unknown or shared callers do not cause guessed household notifications.

Messages are computed from saved routes and server records, bound to the route identity and contact, and immutable after queueing. Raw SMS health content is not copied into outbound alerts. Long/Unicode names use bounded compact wording, preserving the record ID and the existing single-segment limit. Generic manual templates remain available. Existing consent rechecks, rate limits, delivery receipts and the phone-only filter are retained. The staff queue's SMS badge continues to describe the assigned staff alert, independently of family delivery.

The installed database passed transactional rollback tests for both recipient types, identity and callback content, raw-note exclusion, duplicate prevention, denied forged messages, withdrawn sharing, missing channel consent, all Unicode template variants and claiming an existing message after a profile rename. The rollback tests send no carrier messages and leave no fixture accounts. A further 36 targeted local tests passed; advisors introduced no new warnings.

At configuration review, S001 had family sharing enabled and one active linked family account, but no confirmed SMS-enabled family mobile. Real family handset delivery remains pending that configuration and a new physical SMS test. This migration does not resend already-sent coordinator alerts or backfill old household notices. No GitHub push was made.
