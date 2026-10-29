# Supabase backend

Samarth Care supports a standalone Supabase backend alongside its local SQLite showcase and existing Sites identity integration. The separate project is `gfymsmmgvecbzopypmfz` in Mumbai, under CodeBurner. The project-creation quote was $0/month. The free showcase does not establish production capacity for 10,000 seniors; quotas, retention, sending costs and capacity need measurement before a real rollout.

## Standalone configuration

Keep environment values on the server in an ignored `.dev.vars.supabase` file. The root launcher documents how to select this configuration.

Double-click `Start Samarth Care.cmd`, or run `npm run supabase:configure` and then `npm run dev:supabase` after stopping the local fixture server. The standalone portal uses port 5173, normally `http://127.0.0.1:5173`. The configured workspace owner signs in as Operations Manager; do not create a duplicate owner account. Private access details belong only in the ignored local file `outputs/owner-access.json`. Do not commit or publish that file. New invited accounts must complete the required Auth confirmation and redeem their assigned invitation; confirmation alone grants no care membership. If an email confirmation opens a different localhost origin, sign in on the opened origin.

```dotenv
SAMARTH_AUTH_MODE=supabase
SAMARTH_BACKEND=supabase
SUPABASE_URL=https://gfymsmmgvecbzopypmfz.supabase.co
SUPABASE_PUBLISHABLE_KEY=<active publishable key>
SAMARTH_ALLOW_SIGNUP=true
```

The normal application store explicitly refuses `sb_secret_` and legacy `service_role` keys. Every database request uses the signed-in person's access token plus the publishable key. Database row policies enforce the same fresh membership scope even if someone bypasses the app API and calls Supabase REST directly. Tokens are stored in HttpOnly, SameSite cookies; HTTPS adds Secure. Server-side Auth `/user` verification supplies identity, and editable user metadata never grants a role. Refreshes rotate cookies and revalidate identity.

## Owner and invitations

The workspace owner address is configured privately during setup. A trusted administrator provisioned the account and confirmed its Auth email status with authorization; this administrative confirmation is not independent proof of mailbox ownership through a delivered verification link. The first workspace is initialized. Registering another account alone grants no care access. The bootstrap setting cannot be changed by browser callers, and a later setting change cannot take over an existing workspace. The optional `showcase-setup` function requires the private `SAMARTH_SHOWCASE_OWNER_EMAIL` setting and fails closed if it is absent.

The owner has **one account with four showcase memberships**, including coordinator administrator access. These are four role choices after the same login. Other accounts receive an email-bound invitation with an explicit role and senior or scope. Invitations store a SHA-256 token hash, expire after seven days and are redeemed once against Auth's verified email. Invitation creation does not send an email. Share the generated link through an agreed channel. Duplicate invitations cannot create duplicate active role grants, explicit empty staff scopes are rejected, and revocation removes the assignment and outstanding role-selection sessions.

## Schema and row security

`supabase/migrations/20261027183015_care_backend.sql` creates the standalone schema. Apply the full migration directory in filename order. The connected project also has the scheduler, integration, care-operation, speech, durable n8n claim, prepared SIM, event-envelope and signal-binding safeguards applied; use migration history for the exact current set. The event API remains compatible through a fixed list of named operations; arbitrary SQL is never accepted from the application. New vitals, medication logs and notes also populate typed tables within the same transaction. The projection reads nested `record.vitals` and `record.medication`, preserving dose counts and entries.

All public care tables enable row-level security. Family accounts cannot read raw clinical events, typed vitals, notes or full score payloads. The bounded score RPC returns only `familySafe` or `seniorSafe`; family reads additionally require current sharing consent. Coordinator and operations reads stay within assigned senior IDs. Full score payloads and clinical details remain staff-only. Consent withdrawal and membership revocation take effect without waiting for a JWT claim refresh.

Delivery drafts remain invisible to family REST callers until delivered. A recipient's receipt operation can update only their own delivered in-app item to read; it cannot edit content, recipients, attempt counts or approval status. Coordinator dispatch can obtain a bounded recipient list and that recipient's subscription through narrowly checked private helpers. It does not gain broad access to the subscription table. Atomic leases prevent simultaneous dispatchers from claiming the same attempt. Browser push is still at least once if a process dies after a provider accepts a notification but before the database records success.

## Care ownership and follow-ups

`20261029071603_care_operations_guard.sql` adds a private fictional roster snapshot and a trigger on care-operation events. Clients cannot read or change the validation snapshot. Assignment management requires a coordinator administrator with full senior scope. The database verifies the roster identities, current city revision and exact capacity counts under a transaction lock; no counsellor can become primary owner of more than two demo households. The fixed seed corresponds to the reference-informed cohort and must be updated by a migration if its senior/city mapping changes.

Scoped coordinators can create and advance cases for their assigned seniors. Database checks bind the recorded actor to `auth.uid()`, preserve case identity, require consecutive revisions and enforce contact and outcome evidence. These records are append-only. Operations managers can inspect them; family and senior accounts cannot read the staff notes. Direct REST inserts receive the same checks as application requests. No new service key or broad client privilege was introduced. `tests/care-operations-hosted-rollback.sql` passed with all fixtures rolled back; authenticated local HTTP tests also persisted an assignment and a clearly labelled, cancelled synthetic acceptance case.

`20261029072750_care_operations_envelope.sql` rejects payload fields that could shadow the database envelope, non-text action evidence, invalid case identities and numeric timestamps. Later boundary corrections also fix JSON-expression precedence and protect bridge state, contact identities and approved signal provenance. The service assigns receipt timestamps; these do not prove when a human contact occurred. The app keeps the database event kind authoritative when reading JSON.

## Speech, n8n and prepared SIM boundaries

Speech drafts carry a signed receipt from the paired local service. The database verifies its signature against the private Vault setting, actor, senior, origin and bounded provenance; reviews are append-only and an approved care signal must match its stored review. An unreviewed or rejected transcript is not a care observation. The laptop runs inference; the hosted Worker does not fetch its loopback endpoint. Exact-origin browser pairing still needs the local process and any browser local-network permission. Microphone/public-to-loopback browser acceptance remains unverified.

`care_n8n_claim_report` is a service-only, security-invoker wrapper over a private guarded function. It locks and reserves an awaiting report once, rejecting another inference even with a fresh nonce. Only validated callback output creates a pending-review report. The user supplied [the n8n workspace URL](https://samarth-care.app.n8n.cloud/) and reports the Pro 10,000-execution allowance. The page is reachable; workflow import, authenticated setup, actual model use and Gateway balance remain unverified. Browser control is disabled in Work settings and no n8n connector is available, so the application integration remains disabled until setup is completed.

Prepared SIM jobs have scoped approved contacts, explicit consent, one caller lock, state revisions and a leased worker receipt boundary. They stay disabled without a separately verified Linux/Asterisk Bluetooth setup. The phone is now USB-connected and debugging is authorized. SMS Gateway setup and live delivery acceptance are in progress; no actual SMS or carrier call has been made.

## Background processing runtime

Normal browser traffic never uses the service role. The deployed Edge job uses Supabase's automatic server-side service credential only after checking a separate job secret. The secret is generated inside Postgres, stored in Vault and compared through a service-only RPC against a SHA-256 hash. `care_job_configuration()` is also service-only and reads VAPID settings from Vault. Browser callers cannot execute either RPC or read those private settings.

The scheduler migration installs `pg_cron`, `pg_net` and Vault dispatch. A periodic job and a throttled event trigger call the Edge function with an empty JSON body, avoiding names, notes or readings in network webhook payloads. Read the generated scheduler migration and deployment status before claiming scheduling is enabled. A local-only server must remain running for its own scheduler to run.

## Verification

Run `node --test tests/access.test.mjs tests/supabase-auth.test.mjs tests/supabase-store.test.mjs` for access, Auth and adapter regressions. The optional `tests/supabase-db-check.mjs` executes the actual PostgreSQL migration and policies in a separately installed PGlite runtime:

```powershell
$env:PGLITE_MODULE='C:\path\to\node_modules\@electric-sql\pglite\dist\index.js'
node tests/supabase-db-check.mjs
```

It verifies verified-email invitations, raw-family denial, safe cache redaction, scoped coordinator isolation, consent withdrawal, revocation, private drafts, receipts, cursor pagination, dispatch leases, consent seeding and service-only job capabilities. These local policy tests complement hosted SQL verification and the Supabase security/performance advisors after migration deployment.

The policy cleanup removes duplicate permissive read checks introduced by `FOR ALL` write policies and makes private-table client denial explicit. New indexes may appear as unused until workload accumulates; that informational notice alone is not evidence to remove an index. Recheck [Database Advisors](https://supabase.com/docs/guides/database/database-advisors) after schema or policy changes.

References: [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase Vault](https://supabase.com/docs/guides/database/vault).

## Hosted checkpoint - 29 October 2026

The current safeguards described above are applied to the connected project. The owner workspace is initialized with four role memberships and 200 cached senior scores. These are reference-informed synthetic showcase data, not patient records or clinical validation; the exact migration set is recorded by the database history.

Actual owner sign-in through the local and public application and all four role choices succeeded. HTTP acceptance also verified a persisted evidence report, family denial and idempotency. The latest source checkpoint passed 272 Node tests, 13 Python speech-service tests, TypeScript and targeted lint. A real 11-second English clip was transcribed locally in about 3.1 seconds on the CPU through the signed flow; replay returned 409. This is not a Hindi/mixed-language or clinical accuracy benchmark. A fresh browser UI run remains unavailable; HTTP and hosted database acceptance do not establish microphone or local-network permission behavior.

Four hosted rollback suites passed: `tests/supabase-hosted-rollback.sql`, `tests/speech-hosted-rollback.sql`, `tests/n8n-claim-hosted-rollback.sql` and `tests/sim-call-hosted-rollback.sql`. They cover identity/scope/consent, receipt and review provenance, one-time report claim/completion and SIM event boundaries. All synthetic fixture users and rows were rolled back; they are separate from the initialized showcase workspace.

`daily-care` version 6 and `n8n-hooks` version 4 are active with JWT verification enabled; the 15-minute cron job is active. A protected daily dispatch returned HTTP 200 and completed processing against the initialized workspace. Live n8n-hook probes rejected missing JWTs, invalid HMACs, unknown jobs and anonymous service-RPC access without invoking a model or provider. `voice-hooks` is also active. These deployments do not establish a connected n8n workspace, live model execution or answered carrier call. Browser notifications need an explicitly subscribed browser; two-device audio and real carrier delivery still need hardware acceptance. See [N8N.md](N8N.md) and [TELEPHONY.md](TELEPHONY.md).

The advisors report no duplicate-policy warning after cleanup. Two security advisories remain. Leaked-password protection is disabled; review [Supabase password security](https://supabase.com/docs/guides/auth/password-security) before real-user rollout. The `pg_net` installation is in `public` and reports `extrelocatable=false`; it was not dropped or altered through unsupported catalog updates. Its HTTP objects remain in `net`, and the app exposes only registered RPC operations. Review the [extension-in-public advisory](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public). No paid upgrade was enabled to remove an advisory. Unused-index informational notices are expected on this new database.

The Sites connection is restored. [The public website](https://samarth-care.abloomgecko40.chatgpt.site/) version 3 was deployed and verified with real Supabase sign-in and all four role bootstraps. The final deployment receipt identifies any subsequent release of this source. Public hosting and local speech/phone processes have separate availability boundaries.
