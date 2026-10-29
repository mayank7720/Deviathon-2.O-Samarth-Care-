# Automatic daily care processing

The same care workflow runs from the coordinator's **Run daily processing** control, the local development worker, or a dedicated Supabase Edge Function. Scores, alerts and deliveries use the workspace's India-time live date or selected replay date. Repeated execution for the same data revision is safe: daily jobs and delivery identities deduplicate work. Weekly family drafts still require a coordinator's approval before delivery.

## Local development

`npm run dev` launches a hidden, checkout-local job worker that checks local D1 once per minute while the development process is running. It closes with that process. `npm run jobs:daily` runs one local pass. Neither command impersonates a Supabase account; they skip the cloud backend. Built local previews can use the manual processing control or run the local job command separately.

## Supabase background function

The `daily-care` Edge Function is a dedicated server entry point. It accepts only a POST with an empty JSON object. It does not accept a workspace, senior ID, database URL, arbitrary SQL or remote callback URL from the request. The project's JWT verification remains enabled. A second private `x-samarth-job-secret` credential must pass a service-only database validation before any care operation runs.

The function obtains its URL and server credentials from Supabase's automatic environment. It reads the modern `SUPABASE_SECRET_KEYS` and `SUPABASE_PUBLISHABLE_KEYS` JSON dictionaries, with legacy `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` fallback. Modern secret keys travel on `apikey` only; legacy service JWTs use Bearer authorization. Its separate `lib/service-job-store.mjs` starts locked, validates the private scheduler secret, and then permits only named background operations. This privileged module is not imported by normal care APIs. Ordinary application requests retain the verified user's token, assigned scope and RLS checks.

The server secret/service-role credential can bypass RLS and belongs only in this trusted background runtime. It is never included in browser code, request bodies, source-controlled configuration, job responses or logs. Responses contain operational job/delivery counts; raw scores, names and notes are discarded. The function rechecks active recipients and family consent during delivery processing. It never generates a diagnosis or sends health information to an AI service.

## Database scheduling

The scheduler migration configures `pg_cron`, `pg_net` and Vault in the selected Samarth Care project. A random private job credential is generated within the database; a hash is used for validation and the request credential stays in Vault. The caller's public project JWT is also read from Vault when invoking the JWT-protected function. Neither credential needs to appear in a cron command or browser setting.

A periodic job invokes the function every 15 minutes. Relevant clinical/workflow changes additionally dispatch a generic request after database commit, with a short global rate limit to avoid one invocation per row in a burst. The request body contains no names, readings or notes. The function reads authorized background data directly from its own Supabase project. The periodic job covers deferred bursts and retries, including processing after the India calendar date changes.

Browser push requires the same VAPID application keys used to enroll browsers. After private job validation, the function reads them through the service-only `care_job_configuration()` RPC from Vault entries `samarth_vapid_public_key`, `samarth_vapid_private_key` and `samarth_vapid_subject`. They are never returned to normal callers. Without those keys, in-app delivery can work while push attempts record a configuration failure. A push-service acceptance remains distinct from a human read receipt.

Supabase scheduling, actual deployment and successful invocation must each be verified. Checked-in source and unit tests alone do not establish that a cron job is active. The final delivery message records the deployed state. There is no guarantee that free-plan quotas suffice for 10,000 seniors; this implementation targets the 200-person synthetic showcase.

## Verification

Run:

```powershell
node --test tests/service-job-store.test.mjs tests/api-workflows.test.mjs
npx tsc --noEmit
```

The service tests cover the initially locked store, invalid/private credentials, user-token rejection, allowlisted RPC, bounded requests and sanitized responses. API integration tests exercise the actual SQLite job, consent, approval and receipt workflow. After deployment, inspect the named cron job's active status, recent HTTP status codes, and the application daily job record; inspect only operational fields and avoid selecting Vault plaintext into output.

The scheduling design follows Supabase's [Edge Function scheduling guide](https://supabase.com/docs/guides/functions/schedule-functions), [pg_net reference](https://supabase.com/docs/guides/database/extensions/pg_net), and [Cron installation guide](https://supabase.com/docs/guides/cron/install).
