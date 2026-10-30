# Weekly summaries, monitoring and calling controls

The release preserves collaborator commit `a53296d` (the fictional senior preview) while keeping actual senior sign-in available. The preview links to `/sign-in`, remains clearly fictional and stores only its own browser-tab examples.

## Weekly summaries

AI draft creation waits for the connection check and defaults to the n8n model. It does not silently submit a recorded-data summary while connection status loads. A fresh actual model run completed on 31 October IST using `gpt-5-mini-2025-08-07` and eight evidence entries. The saved result remains pending human review; no real-family approval was performed by verification.

The staff page explains Create → Review → Share, shows review/sharing status, and can prepare new family review copies from an existing saved report after a family link is added. This does not repeat inference or publish an unreviewed draft. Report reads explicitly query report events, so unrelated operational history cannot displace them.

The family view refreshes on focus and every 20 seconds while visible, offers manual refresh and displays reviewed inbox history. Hosted rollback checks confirm pending drafts are hidden, delivered reviews are visible to the linked family, unrelated seniors are denied, and consent withdrawal hides shared data. All fictional test records roll back.

## Medication patterns

Charts support day, calendar week and calendar month grouping, retaining unobserved groups as gaps. Doses sum from actual logged outcomes; no medication record is interpreted as a missed dose. Per-medicine outcomes and recurring scheduled-time misses have separate charts and explicit empty states. Invalid/conflicting medication snapshots remain unknown in both totals and charts. A lightweight chart-data module avoids loading the analysis engine merely to group chart bars.

## Navigation

The authenticated workspace mounts in a persistent `/workspace` layout. Internal section navigation updates Next.js pathname through its documented History API integration, preserving the current identity, bootstrap data and sidebar. Section-specific data still loads from protected APIs; the full sign-in/bootstrap screen is not recreated for each menu click. Direct links, back/forward navigation and fresh page loads retain route and server-side access checks.

## Calling

Operations has cloud-stored controls for new-call pause, an optional daily calling window (including overnight windows), all-day access and HELP callbacks/briefings outside routine hours. The former two-hour demo option is superseded by these controls. Defaults remain unchanged on migration; no participant is enrolled or called automatically.

The API, manual request database guard, scheduler and protected carrier dispatcher enforce the saved policy. An already accepted carrier call can finish after a pause. Consent, account assignments, exact current phones, trial-only billing checks, deduplication and allowance limits remain enforced. A fresh provider account check established Trial status; the user reported 74 free Voice minutes. The application does not add or replace recipient numbers. One-time receiving-phone verification is a Twilio trial prerequisite, separate from account contact storage and automatic routing.

## Validation

508 automated tests passed, alongside TypeScript, targeted ESLint and a production build. Hosted rollback checks cover policy revision/access, overnight and all-day bounds, HELP exceptions, complete senior-to-care-owner sequence, four-role recipient routing and summary sharing. No carrier call or SMS was sent during these checks. Physical application bot-call acceptance remains pending. Browser control was unavailable, so new browser visual acceptance is not claimed.

Publishing uses one consolidated development milestone after fetching and preserving collaborator changes. Private environment files, local evidence, deployment tooling and generated output are excluded from tracked source. The public showcase repository remains separate from development updates.

Production deployment `dpl_HbrCiqCUw5uSPy5ii8yu8Qy5piGK` is promoted at https://swasthsync.vercel.app/. The 298-file runtime manifest has SHA-256 `7d02db4b97c867cdf21c08219174543bf5e4dec5cef99ace1707d89b0760a123`. Supabase migration `20261030195414_configurable_voice_policy`, `n8n-hooks` v12 and `call-automation` v3 are installed; the scoring algorithm version is unchanged. Public checks passed for sign-in, protected workspace routes, the fictional senior preview, the real model draft and all medication totals across 7/30/90-day windows grouped by day/week/month. Preparing existing family copies was idempotent. Automatic calling remains paused with the user's reported 74-minute allowance; default calling hours are preserved until Operations changes them.
