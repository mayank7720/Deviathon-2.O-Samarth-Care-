# Account, invitation, summary and notification release — 30 October 2026

This checkpoint covers account identity safety, account password controls, family summary access and role-specific care routing for the Samarth Care Deviathon prototype.

## Account access

- Operations remains the only administrator. The console can create a senior record with its own login, enable login for a recorded senior, create family or coordinator accounts, assign their permitted links, and choose or generate an initial password.
- A senior login belongs to that same senior record. Family links and coordinator caseloads are separate permissions. Database guards reject mixed login roles, moving a senior login to a different person, duplicate senior logins and extra Operations accounts.
- Account holders in all four portals can change their own password after confirming the current password. The server sends passwords only to Supabase Auth, invalidates that account’s care sessions, and asks the user to sign in again. Operations can reset a subordinate account password from its account details.
- Invitations identify the intended role, remain tied to the invited email and expire. A recipient creates or confirms their login, signs into the role named in the invite, then accepts the invitation; acceptance activates only the authorized relationship. Family and senior users can manage household links but cannot change coordinator assignments.

## Family updates and notifications

- Family pages now display only an approved weekly update from the signed-in recipient’s care inbox. A pending model or rules draft is not exposed. When there is no approved update, the page explains the review state and lets family members save a request for their care team.
- Care requests create a durable, deduplicated in-app notice and a role-specific SMS route intent for the current assigned care coordinator. The system checks current account scope, mobile confirmation, SMS consent and family sharing consent when routing. Number replacements and withdrawn permissions affect unsent messages. Repeated notices are rate-limited.
- Coordinators can inspect routing status and the reason a message is waiting or blocked. Call requests notify staff; a request alone never dials a senior. The Android relay must be online and authorized for the recipient’s care scope before it can act. Carrier charges, handset receipt and live delivery depend on the configured phone and SIM.

## Public landing page and source

The public login page uses a clearer role chooser and invitation steps. Its human-first home-care layout takes structural inspiration from Samarth Life Management’s public site; this project is an independent Deviathon prototype and makes no affiliation claim.

## Verification and boundaries

The automated suite passed 372 tests, the Next.js production build succeeded, and private HTTP checks accepted the right role and rejected wrong-role sign-ins for all five showcase identities. Operations, coordinator, family and both senior accounts opened their permitted portal data. SQL rollback checks passed for senior onboarding, role identity, password session invalidation, notification routing and approved family summaries; fixtures were rolled back. No SMS or calls were sent during these checks.

The contact registry currently has no active phone numbers configured. Add a confirmed number and its SMS or call permission under Accounts before testing a real destination. One extra database guard migration for telephone wellbeing bots is in the repository but was not applied to the hosted project during this release session.
