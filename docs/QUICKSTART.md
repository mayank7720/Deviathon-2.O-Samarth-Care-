# Running SwasthSync

## Choose the appropriate mode

| Mode | Needs | What it demonstrates |
|---|---|---|
| Public website | Assigned account | Existing cloud workspace; https://swasthsync.vercel.app/ |
| Local synthetic fixture | Node 22.13+, npm; no private credentials | Four local roles, synthetic data and local persisted care workflow |
| Connected development | Your own authorised Supabase configuration | Hosted identity, database policies and cloud-only account/report controls |

## Local fixture

```bash
npm ci
npm run db:init
npm run dev
```

Open http://127.0.0.1:5173/. Use the local role choices on sign-in. Keep fixture mode on loopback; do not expose it to the internet. `db:init` applies the local SQLite/D1 migrations, not the hosted Supabase migrations. Stopping and restarting retains the local store under `.wrangler/`.

A clean fixture needs no `.env.local` or `.dev.vars` file. If you previously selected cloud mode, stop that process and use a separate clean checkout for fixture testing. Optional integrations stay unavailable until configured; a queued job or rehearsal does not establish external delivery.

The fixture does not provide hosted Auth account provisioning or every Supabase-specific management operation. A deliberately unavailable cloud feature should not be presented as a fully functioning local subsystem.

```bash
npm run dev -- --port 5180
```

Use the printed port if 5173 is occupied. The separate local demonstration pages `/demo` and `/demo/senior` are explicitly fictional previews and do not authenticate a real care account.

## Connected development and environment variables

The committed `config/supabase.json` contains public connection information for the existing showcase, not an administrator credential. It does not grant care access. For an independent installation, create your own project and apply the schema before connecting.

For the portable Vite/Cloudflare development path, copy `.env.example` to the ignored `.dev.vars.supabase`, supply your own configuration, then run:

```bash
npm run dev:supabase
```

For native Next.js development, copy `.env.example` to `.env.local`, supply your own configuration, then run:

```bash
npx next dev --port 5173
```

The native server always requires Supabase authentication. The Vite path reads the selected Cloudflare development configuration. Standalone relay scripts use their separately documented ignored `.dev.vars.*` files, not Next's automatic environment loading.

`npm run supabase:configure` is a convenience for authorised maintainers of the existing showcase; it writes the committed public project settings only if the ignored file is absent. It is not a fresh-project database installer.

Follow [Supabase configuration](SUPABASE.md). Registration alone must not grant staff access. Never copy a service-role key into normal application configuration or a browser-exposed variable.

## Optional integrations

| Integration | Additional requirements | Reference |
|---|---|---|
| Weekly LLM draft | Your n8n workspace, compatible model allowance, signing credential and protected callback worker | [n8n](N8N.md) |
| Real SMS | Consented registered test phones, Android SMS Gateway, SIM plan, USB relay and signed receiver | [Phone-first care](PHONE_FIRST_CARE.md) |
| Local transcription | Python speech environment, installed model and paired local process | [Speech](LOCAL_SPEECH.md) |
| AI calls | Deferred; no live showcase acceptance | [Call bot status](AI_CALL_BOT.md) |

The website runs in the cloud independently of the laptop. The current SMS relay and local speech service depend on the laptop and devices remaining online. n8n credits, model credits and SIM allowances are separate.

## Build and verify

With the local fixture server running, `npm run smoke:local -- http://127.0.0.1:5173` checks four roles, scoped access, analysis, messages, consent and simulated phone entry. It saves fictional local test events and sends no real message or call. Use a disposable fixture, never a connected care workspace.

```bash
npm run check:repo
npm test
npm run typecheck
npm run build:vercel
```

`npm run build:vercel` builds the native Next.js deployment. For a Windows checkout whose dependencies are an external directory junction, `npm run build:vercel -- --webpack` avoids the local Turbopack external-directory restriction. Clean CI installs do not use that junction.

`npm run build` builds the alternate Vite/Cloudflare path; `npm start` serves that built local fixture. Node may display an experimental SQLite warning; it does not indicate that hosted Postgres is being modified.

## Troubleshooting

- **Wrong portal or rejected credentials:** use the account's assigned role. Local fixture options are not hosted credentials.
- **Cloud account page unavailable in local mode:** use connected development to exercise Supabase-only capabilities.
- **SMS request remains queued:** check device heartbeat, Gateway Local Server, SIM selection and the receiver. Sent/delivered/read are distinct states. RCS is a separate unsupported path.
- **AI report unavailable:** inspect the saved job and n8n execution. An explicit computed report remains a no-LLM result. Do not blindly repeat generation.
- **An empty chart:** inspect the date window and recorded outcomes. Missing medication logs are not automatically missed doses.
- **Database policy fixture:** run only in a disposable test project after reading the SQL; these are separate from local unit tests.
