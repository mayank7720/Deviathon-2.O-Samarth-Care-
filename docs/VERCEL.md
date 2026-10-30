# Vercel hosting

Canonical public origin: **https://swasthsync.vercel.app/**. Earlier Samarth Care domains are retired. This repository contains source, not the maintained project's private deployment credentials.

## Build and runtime

`vercel.json` selects native Next.js and `npm run build:vercel`. Normal API traffic uses Supabase authentication, current memberships and database policies; production never enables local fixture login. Supabase's protected scheduled processor owns background care processing. A public deployment does not create Auth memberships, run migrations or connect a phone.

For an independent deployment:

1. Complete the separate [Supabase setup](SUPABASE.md), using your own project.
2. Import this repository into your Vercel project and use the committed Next.js build configuration.
3. Set server-side environment values from `.env.example` for your own backend. Add separately required callback/worker configuration only for integrations you are enabling. Never use a service-role key for normal user traffic or a browser-exposed variable.
4. Set `SAMARTH_PUBLIC_URL` to your HTTPS origin. Configure exact matching Auth redirects, signed callback URLs and paired-service allowed origins. Browser notification permission is specific to an origin.
5. Verify sign-in for assigned roles, scoped reads/writes and actual optional integrations before presenting them as working. Environment changes require a new deployment to take effect.

[Official Vercel environment documentation](https://vercel.com/docs/environment-variables).

## Local production preview

With a separate authorised `.env.local` configuration:

```bash
npm run build:vercel
npm run start:vercel -- --port 5180
```

Use the printed loopback address consistently. The server normalises exact same-port loopback origins without trusting arbitrary forwarded headers. The alternate Vite/Cloudflare fixture remains available through `npm run dev`.

## Maintained showcase status

The published n8n report workflow has generated genuine drafts from public-site requests. Generation is explicit, bounded by available credits and followed by human review. The call bot remains under development and is excluded from the current live showcase. Current status is in [PROJECT_STATUS](PROJECT_STATUS.md); older deployment IDs and earlier disabled-integration decisions remain in dated release notes.

The Android SMS gateway and local transcription service depend on their paired devices/processes even while the website is available in the cloud. Hosting, n8n executions, model credits and carrier/SIM allowances are separate costs. No 10,000-person capacity or zero-cost production guarantee is established.
