# SwasthSync domain migration — 30 October 2026

Public website: https://swasthsync.vercel.app/

## Hosting and retired addresses

The existing CodeBurners Vercel project was renamed from `samarth-care` to `swasthsync`, retaining ID `prj_qFF1AwMbffciaSOKVfsoMRfwCcwr` and the existing free hosting resources. The new domain is verified and remains attached to this project for subsequent production deployments.

Production deployment `dpl_4WU2aGeV7aWoXiPvamsqUM4xgB7f` was built with the migrated production configuration, checked while staged and promoted. Its 264-file runtime source has SHA-256 `b32ee2a97bbd164960c276a8b6ddf9428cc00e863b51fe0616133866eab484bf`, based on upstream `edbcde91927bc243c57c3eee6cff600609f7dd7d` plus preserved local work. No GitHub push was made.

These public addresses were removed and individually verified to return HTTP 404 rather than serve or redirect the application:

- `samarth-care-codeburners.vercel.app`
- `samarth-care-code-burners.vercel.app`
- `samarth-care-ochre.vercel.app`

The project-domain listing now contains only `swasthsync.vercel.app`. Vercel's generated deployment inspection addresses and its SwasthSync team alias are platform infrastructure, not application integration targets.

## Migrated integrations

- Vercel production `SAMARTH_PUBLIC_URL` and the protected Supabase Vault public callback setting use `https://swasthsync.vercel.app`.
- Supabase Auth Site URL is the new origin and its redirect allowlist contains the new root URL. This was saved through the authorized dashboard session; the local CLI lacked configuration access. Existing users, passwords, roles, consent and care history were retained.
- The published n8n report workflow's claim and save callbacks were edited to the new origin and published as “SwasthSync domain migration”. Signing credentials and model/privacy settings were preserved. The reproducible Gateway workflow export also uses the new origin for claim, success and failure callbacks. The n8n Cloud workspace URL remains the provider's own workspace address.
- Private Android relay, phone intake and local server settings use the new application origin. The phone intake receiver was restarted with the migrated configuration and its authenticated worker was checked after the old addresses were removed.
- Local offline transcription accepts the new public origin and existing loopback development origins. The old website origins were removed. The installed speech service was started; preflight from the new origin returned 204 and the old origin returned 403.
- Active README and setup-guide links were updated. Older dated release documents remain historical evidence and do not configure running services.

No active report execution or unfinished old-origin provider call was found before retirement. Existing sent messages were not resent, and no completed report or health record was rewritten.

## Verification and remaining browser action

The staged production release passed real Supabase staff sign-in, secure cookies, role selection, protected phone-queue reads, helpline configuration, rejection of unsigned ingress/sending, an actual gateway probe and a signed heartbeat. After promotion and removal of the old addresses, staff login and routing reads passed on the new domain and the phone worker reported no error. The new website returned HTTP 200; all three retired addresses returned 404. Twenty-five targeted n8n and origin-security tests passed; the unchanged application had already passed the full 456-test suite before this configuration migration. The new Vercel build/type checks passed.

Signed claim/callback probes for nonexistent report jobs reached the durable integration guard and were rejected with HTTP 409. This verifies authenticated transport without creating a report or invoking a model; it is not a new LLM-generation demonstration. Verification sent no SMS, placed no call and generated no paid model request.

One browser notification subscription predated creation of the new domain. It was disabled so it cannot send users back to a retired address. Browser permission and service-worker subscriptions cannot be copied between origins. The user chose to enable notifications again in Notification center on the new site; successful re-enrolment has not yet been demonstrated. In-app notifications and SMS do not depend on that browser permission. The previously missing family SMS number is a separate outstanding account-configuration item.

The final resumed check reconfirmed the production callback origin in Vercel and Vault, real staff login, protected queue/routing reads, healthy phone processing, the live transcription service and all three retired-host 404 responses. There were no active legacy browser subscriptions and no new-domain browser subscription yet. The published n8n claim/save URLs and Supabase Auth URL settings were visibly confirmed during configuration; the later browser connection was disabled, so a second browser audit and final screenshot were unavailable. No additional model execution was started to test a domain change.
