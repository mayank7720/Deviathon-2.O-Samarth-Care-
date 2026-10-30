# Account, monitoring, medication and SMS upgrade

## Delivered changes

The Operations account directory now opens a focused account workspace with Profile, Care access, Mobile & channels and Sign-in & security sections. Account-bound mobile configuration is available inside that person's workspace. Senior identities remain locked to their own care record. Subordinate sign-in emails can be edited with ownership confirmation, duplicate/stale-email checks, an idempotent request, Auth update, membership synchronisation, audit and session invalidation. The sole owner identity is protected from overrides. Existing passwords remain one-way hashes; newly generated initial/replacement passwords are displayed once and never stored in care records.

A new Health & medications page provides calendar-complete 7/30/90-day BP, glucose, oxygen, weight and medication charts, units, legends and a dated table alternative. Unobserved days and pending dose outcomes remain distinct from missed doses. Per-medicine recurrence and time-of-day gaps show the supporting dates. The page can save a human medication-review follow-up assigned to the signed-in staff member. No interaction database, dosage recommendation or prediction of a medical condition was added.

Weekly reports now refresh the saved job after submission, including ambiguous failures, poll for both report and family-delivery state, and clear data when switching seniors. A single-senior delivery filter prevents unrelated recipients from filling the review view. Scope-based family links are included once. Each report exposes its eligible family deliveries and allows a coordinator to approve and publish a reviewed summary to the existing protected inbox. Lack of a linked/consented recipient is explicit. Computed mode remains labelled as no LLM.

SMS intake combines the existing trained shadow intent classifier with a separate 14-category care-needs lexicon. It adds medicine supply, extra-dose reports, schedule questions, dizziness, fainting, mobility, speech changes, vomiting, loose stools, fluid intake, feverishness, swelling, urinary discomfort and care-access requests. Source evidence and assertion handling are retained. The lexicon is authored language understanding, not a newly trained clinical model. See `SMS_NEEDS_REVIEW.md` for references and limits.

## Cloud release and checks

Production website: https://swasthsync.vercel.app/. Verified release `dpl_AZ9xvj55z6dvFAg3XxdaqBQEd2ec` was promoted from its staged production build. Runtime source: 268 reviewed files, SHA-256 `1be312ff173f1c21b905805f63ca3687a4990deb36cadc05b4fbe6bf2cfd009f`. Earlier unpromoted builds were used during final checks; this is the deployed source. The phone-only intake receiver was restarted to load the new SMS lexicon without enabling the broad historical notification queue.

Database migration `20261030123537_account_email_management.sql` passed hosted transactional rollback tests before and after installation. The existing JWT-protected `account-admin` Edge function is ACTIVE at version 4. Its unit tests cover identity binding, duplicate/stale/owner rejection, idempotency and exclusion of passwords from care storage. Existing security-advisor warnings were unchanged.

The final complete local suite passed 464 tests. The new/edited standalone account, monitoring and report components passed targeted lint; the full repository still has previously documented lint debt. Production compilation and TypeScript checks passed. Runtime source is based on upstream `edbcde91927bc243c57c3eee6cff600609f7dd7d` plus local work; no GitHub push was made.

Staged API checks passed staff sign-in, secure cookies, protected queue access, the owner-protected email endpoint, 7/30/90-day monitoring responses, single-senior delivery filtering, real Android gateway probing and signed heartbeats. A real computed report was saved from S001's available stored observations as a pending-review draft, using a stable verification request key; it was not approved or sent to family as a test. No new user password/email was changed by smoke verification, no SMS was sent, and no call or LLM request was made.

After promotion, the public site passed real staff sign-in, protected queue/routing reads, all three monitoring windows, persisted computed-report retrieval and the single-senior family-delivery filter. The restarted expanded phone receiver confirmed successful cloud checks without worker errors. The stable report request key reused the existing review draft rather than creating a second report.

## Limits and deferred work

The live integration status reports n8n configured/enabled. An enabled flag is not proof that provider generation currently succeeds or that free credits remain. The user explicitly deferred live credit/provider verification; no model request or paid top-up was started. The generated workflow export has signed failure branches, but its live failure-path publication still needs checking. Automatic weekly LLM scheduling was not introduced. Existing family views read reviewed inbox summaries; families do not receive raw model drafts.

Browser control was disabled during this pass, so the redesigned screens have build/type/API verification but no new visual browser acceptance or screenshot. Expanded SMS language has regression coverage but has not yet been demonstrated through a new physical incoming SMS. Daily scoring thresholds and fitted model revision were not changed, so the existing scheduled scoring worker remains on the compatible personal-risk version.

The wider plan is `deliverables/SwasthSync-Product-Upgrade-Plan.md` in the workspace parent: reliable basic-phone ingress, actual voice/missed-call intake, named ownership and outcomes, independent alert labels, two-way check-ins, and measured Operations response times come before claiming additional ML or a real-world care service.
