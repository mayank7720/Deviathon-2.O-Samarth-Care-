# Vercel hosting

Production domain: https://samarth-care-codeburners.vercel.app

The [Vercel release checkpoint](DELIVERY_VERCEL_2026_10_29.md) records the deployed commit, actual HTTPS authentication/role checks, paired-service checks and pending GitHub automation.

Project: `samarth-care`, CodeBurners workspace. The project uses the existing Hobby plan, a Node.js 22 project setting, the installed Next.js 16.3.4 and Mumbai (`bom1`) functions. Its broad package engine range should be pinned before relying on a fixed runtime major. No new database, paid integration or model subscription is required by this hosting change.

## Runtime

`npm run build:vercel` runs the native Next.js build. `vercel.json` selects that command and the Next.js framework. The API imports `lib/server-runtime.mjs`, which always uses Supabase authentication and disables local fixture access. Normal requests retain verified user sessions, scoped memberships and database RLS; no service-role key is needed on Vercel.

The existing `npm run dev:supabase` and Vite/Cloudflare builds are retained. Their explicit Vite alias resolves the same runtime interface to `lib/server-runtime.cloudflare.mjs`, preserving local bindings. Supabase's existing scheduled Edge processor remains responsible for background jobs; no Vercel cron or second scheduler is added.

For a local preview of the native production build, configure server-only Supabase environment variables, then run:

```text
npm run build:vercel
npm run start:vercel -- --port 5180
```

Use `http://localhost:5180` consistently. Next.js normalizes loopback addresses to `localhost`; mixing a `127.0.0.1` browser origin with that normalized request URL can fail the application's strict same-origin check. The normal local Vite launch remains at its existing URL.

## Server configuration

Existing configuration is transferred privately into production environment variables. Keep these server-side, without a `NEXT_PUBLIC_` prefix:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the legacy anon key used for protected Edge callback forwarding.
- `SAMARTH_AUTH_MODE=supabase`, synthetic-cohort settings, signup setting and scheduler status.
- Existing VAPID configuration, Android bridge secret and local speech ticket secret.
- `SAMARTH_PUBLIC_URL` set to the production HTTPS origin.

Private values are not tracked. `.vercel/`, local environment files, tool state and private output artifacts are excluded from Git and deployment uploads.

New public n8n generation remains disabled (`SAMARTH_N8N_ENABLED=false`) under the existing decision to keep new AI requests local. Saved authorized reports and computed reports remain available. Autonomous provider calls remain disabled. Deploying the website does not complete the open items in the [pre-show audit](PRE_SHOW_AUDIT_2026_10_29.md).

## Laptop integrations

The public website runs without the laptop. The Android/SIM relay and local Whisper transcription still need the paired laptop and phone:

- The private relay application URL must point to the new HTTPS origin before jobs are processed there. Preserve existing gateway identifiers and terminal receipts; never resend an old job to test a new host.
- Add the exact new HTTPS origin to the local speech service's allowed origins and restart that service. The speech secret must match its server-side ticket secret. Browser microphone/local-network permission remains a separate acceptance check.
- Existing signed n8n workflows may still point to the old callback origin. Do not switch callback targets or enable public generation without verifying their actual published settings and retained jobs.
- Browser push must be enrolled on the new origin. Permission and service-worker registration do not transfer between domains.

## Release checks

Run the application tests and production build, then check the deployed home page, anonymous auth status, denial of unsigned data requests, verified login, all four assigned roles, runtime date and logout. Confirm HTTPS cookies are Secure, HttpOnly and SameSite=Strict. Role switching on one administrator account does not prove isolation between four distinct users.

Source changes are deployed from a recorded commit. Preserve collaborator commits and re-fetch before pushing; use branches and PRs for parallel changes. An audit checkpoint is historical evidence, not the status of all future deployments.
