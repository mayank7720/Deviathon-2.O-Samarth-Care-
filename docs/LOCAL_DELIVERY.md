# Historical local delivery checkpoint — 27 October 2026

This records the earlier delivery on 27 October 2026, before the subsequent audit fixes, Supabase integration, runtime clock, delivery outbox and phone gateway work. Its test count and model results below are historical evidence for that revision only. Consult the final delivery message and [current showcase status](SHOWCASE_STATUS.md) for the latest source behavior and verification. The existing hosted site and its audience were not changed by this earlier delivery.

## Start the showcase

Double-click `Start Samarth Care.cmd` from the project folder, then open its printed Local URL. Select **Open local demo** under Care Coordinator, Senior Member, Family Member, or Operations Manager. Sign out before entering another role. The four fixtures are separate identities; all records are fictional. No password, paid AI key, or telecom account is needed.

The launcher requires Node.js 22.13 or newer and installs missing npm dependencies. Existing local changes persist in D1. The source ZIP excludes dependencies and runtime data; extract it before launching.

## Verification

| Check | Result |
| --- | --- |
| Automated behavior tests | 98 passed, 0 failed |
| TypeScript | `npx tsc --noEmit` passed |
| Production build | Passed |
| Built Worker HTTP workflow | Passed on loopback port 5174 |
| Four separate local fixture logins | Passed |
| Scoped staff permissions and denied escalation | Passed |
| Nine-domain analysis and three-day projection | Passed |
| In-app Hindi message and recipient read receipt | Passed |
| Four-question Hindi help request | Persisted once; entered urgent alert inbox |
| Urgent alert snooze protection | Passed |
| Family consent revocation and restoration | Passed |
| SMS simulation | Explicit simulated status; no external delivery |
| Original synthetic model evaluation | 93.5% daily precision, 72.5% daily recall, 4.5-day mean lead |

Run `npm test`, `npx tsc --noEmit`, and `npm run build` to repeat source checks. With the local server running, `node scripts/smoke-local.mjs` repeats the HTTP workflow and saves synthetic demonstration messages and check-ins.

## Acceptance limits

The login portal and personal-analysis view were visually reviewed before the interrupted run. Final browser and mobile regression was unavailable after resuming because local browser control was disabled. The built application and its role workflows were subsequently tested through HTTP.

Live microphone/audio quality and two-device network connectivity have not been verified. Browser voice requires two distinct authorized identities, microphone permission, HTTPS or loopback, and compatible networks; there is no STUN/TURN relay. Phone and SMS modes are simulations. On-device dictation and read-aloud depend on installed browser/language support and retain text fallbacks.

The weekly summary is locally composed from observed data; it is not LLM-generated. Medication checks identify adherence and schedule patterns, not drug interactions. Scores and trend projections do not diagnose conditions or predict a validated medical event. Hosting quotas, clinical deployment, and operation at 10,000 seniors are not established by these checks.
