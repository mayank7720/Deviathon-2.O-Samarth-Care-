# Supabase backend

Supabase provides hosted Auth, Postgres and protected background processing. Local SQLite/D1 is an isolated fixture. Start with [QUICKSTART](QUICKSTART.md) and [ARCHITECTURE](ARCHITECTURE.md).

## Existing showcase

The committed `config/supabase.json` contains a public project URL and publishable key. These are identifiers, not administrator access. The live workspace requires an assigned authenticated account. Contact details, owner credentials and worker secrets are not distributed in this repository.

Operations is the administrative role. Public account creation is limited to senior/family routes when enabled; portal selection and editable user metadata do not grant care access. Invitations bind an intended identity, role and senior scope and require the appropriate account setup/acceptance. Creating an invitation does not establish that an email was delivered.

## Independent installation

This is an advanced setup, separate from the credential-free local fixture:

1. Create a separate Supabase project or disposable local Supabase environment. Follow the current [migration guide](https://supabase.com/docs/guides/cli/local-development).
2. Inspect and apply the ordered SQL files in `supabase/migrations/` to the intended clean database. This repository does not include a one-command cloud installer or a complete generated CLI `config.toml`. Some migrations use Vault, `pg_cron`, `pg_net` and hosted Auth features. Review project-specific roster/setup assumptions before applying them.
3. Configure the project's Auth URL and exact allowed sign-in redirects for your own application origins. Use a verified owner identity and the protected owner/setup path; account registration alone must not grant administrator access.
4. Copy `.env.example` to the ignored file for your chosen runtime. Set your own project URL and publishable key, keeping integrations disabled initially.
5. Deploy/configure needed functions under `supabase/functions/`. Server-side worker credentials, Vault settings, scheduler hooks and optional provider configuration are separate from normal user requests. Use dedicated test settings first.
6. Run relevant rollback fixtures only in the disposable test environment and review database security/performance advisors. Fresh-project cloud deployment has not been reduced to a fully automated acceptance script.

Do not run migrations or fixture scripts against the shared showcase without maintainer authorisation. Local `npm run db:init` does not configure hosted Postgres.

## Access and persistence

The normal application adapter accepts the publishable/legacy-anon credential and the signed-in user's access token. It rejects secret/service-role keys for user requests. Server-side Auth verification, fresh stored memberships and scoped database policies enforce care access. Sessions use HttpOnly, SameSite cookies with Secure on HTTPS; passwords are not retrievable plaintext.

Postgres stores observations, events, jobs, contacts, consent, follow-ups, report evidence and revisioned review history. Narrow RPCs validate operations; queued delivery or a transport receipt cannot silently become a completed human task. Family visibility is rechecked against current membership and consent.

Protected background functions have separate capabilities. Normal browser traffic cannot read their Vault secrets or invoke privileged worker operations. Scheduled scoring and website serving must retain compatible algorithm versions.

## Reports and phone integration

The n8n report workflow is connected in the maintained showcase and has stored a genuine model draft. Signed jobs, one-time claims, evidence fingerprints and validated callbacks precede pending review. [Report contract](N8N.md)

Registered HELP SMS has physical intake and coordinator/family delivery evidence. Android SMS and local transcription require their respective devices/processes online. Two-way SMS check-ins and application bot calls have separate pending acceptance; see [current status](PROJECT_STATUS.md).

## Verification

```bash
npm test
npm run typecheck
```

Tests named `*-hosted-rollback.sql` provide separately reviewed database fixture checks. They are not automatically run by `npm test`. Historic release checks are recorded in dated notes; their old function versions, domains and test counts are not current deployment guarantees.

References: [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Auth redirects](https://supabase.com/docs/guides/auth/redirect-urls), [function scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [Vault](https://supabase.com/docs/guides/database/vault).
