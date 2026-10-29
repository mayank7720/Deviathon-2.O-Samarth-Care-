# Dated care history

Open a senior's profile and use **Health history**. Day, calendar week, calendar month, 90-day and custom ranges browse that senior's records without changing the shared workspace date. Weeks run Monday to Sunday in India time. The date picker cannot reveal observations after the workspace's current/replay date.

The timeline includes individual observations, daily review scores, data coverage and period summaries. Entries stay separate even when several measurements belong to the same day. Known measurement times sort newest first; date-only entries follow within that day. The save timestamp is shown separately. A synthetic daily record has no invented measurement or original save time.

## Persistent archive

The initial reference-informed archive contains 200 fictional profiles, 17,226 daily observations over **1 August–29 October 2026**, and 18,000 dated baseline risk snapshots. Missing days and unknown scores during baseline warm-up remain explicit. This is generated demonstration data, not clinical validation.

- `care_history_datasets` stores the generator, seed, date bounds, reference provenance and a SHA-256 fingerprint.
- `care_profiles` persists the fictional senior profiles.
- `care_observations` stores the versioned synthetic archive and projects new signal events into separate records with their measurement date/time, original event reference and database save time.
- `care_risk_history` stores compact baseline and subsequently computed daily scores. It remains separate from the current-day payload cache in `care_daily_scores`.
- `care_events` keeps the original submitted events. Existing contacts, accounts, messages and reports are preserved.

An import is administrator-only, chunked and repeatable. The same dataset version cannot silently replace different observations or scores. Partial imports are not selected as the active archive. The timeline selects one completed version, avoiding duplicate observations from overlapping versions.

```text
node scripts/import-history.mjs --prepare
node scripts/import-history.mjs --import
node scripts/import-history.mjs --verify
```

Preparation writes an ignored local export. Import/verification uses the existing private owner credentials and publishable project key. It does not create accounts or send communications. Running `--resume` replays matching chunks safely; conflicting content fails rather than overwriting it.

## Measurement and aggregation rules

The signal form asks for an observation date and an optional time in Asia/Kolkata. Unknown times remain unknown. The API rejects invalid or future measurement times and observations after the workspace date. Supabase records the actual save time independently.

Daily scoring uses the latest explicitly timed reading for each vital field, otherwise the latest saved entry. Distinct notes remain available, and urgent raw observations are checked before collapsing a day. A later normal reading does not erase an earlier urgent observation from human review.

Period summaries average available readings. Submitted readings replace synthetic values for the same senior/day/field in those summaries. Repeated daily medication totals do not accumulate: the latest daily log replaces the prior total. Explicitly unknown dose statuses remain separate from missed doses.

Backdated entries invalidate derived history from the affected date onward. A durable pending marker survives failed recalculation. Daily processing retries pending seniors, and acknowledges work only if its observation watermark is unchanged. A concurrent new entry therefore cannot disappear behind an earlier successful repair. The website labels pending recalculation.

## Access and pagination

Raw history is available to assigned care staff. Family/senior accounts continue to use their consent-checked safe views and approved summaries. Direct table reads and history RPCs both enforce senior scope.

`GET /api/history/S001?from=2026-08-01&to=2026-10-29&groupBy=month&limit=10` returns independently aggregated coverage, period summaries and risk history, plus a page of individual observations. Subsequent pages use a composite measurement date/time/sequence cursor. Summaries cover the full selected range, independent of which observation page is open. A request is limited to 366 calendar days; older records remain stored and can be selected with another range.

Clinical event reconstruction drains indexed pages and no longer silently uses the latest 5,000 mixed events. Relay heartbeat status is fetched separately; nonce checks use direct identifiers. An exhausted request budget or failed page returns an error instead of treating incomplete history as empty or healthy.

## Verification boundary

Automated checks cover dates, missingness, chronology, repeated measurements, medication totals, pagination beyond 5,000 events, role scope, replay cutoffs, delayed repair and concurrent updates. Hosted rollback checks exercise the actual database policies/functions without keeping test records. These checks do not establish clinical accuracy, real-world accessibility or full 10,000-senior performance.
