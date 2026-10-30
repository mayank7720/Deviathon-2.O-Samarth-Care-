# Portal and cloud workflow release — 29 October 2026

> Historical checkpoint: the current website is https://swasthsync.vercel.app/. Earlier website addresses below are retired; see [domain migration](DOMAIN_MIGRATION_2026_10_30.md).


This checkpoint supersedes the account, portal and n8n status in earlier release notes.

**Production:** https://samarth-care-codeburners.vercel.app/
**Application commit:** `b8e071311ec6490503584c0c9271633471da09b4`
**Deployment:** `dpl_C7a5w6d66Vti2vfj8M4qbYe3A97L`, READY, native Next.js, Mumbai, existing basic/Hobby resources. Source uploaded from a clean tracked-file staging folder; private outputs and local credentials were excluded.

## Changes

- Professional public landing page, four assigned-role login choices, family/senior-only self-registration. Operations provisions staff. Every wrong-role password login is rejected server-side; user metadata never grants a role.
- Removed the workspace switch box and footer role selector. Insights use actual saved data in accessible SVG charts, with unknown values left unknown. Shared follow-up counts contribute to the outcome view.
- Operations can edit/revoke invitations, remove invitation history with an audit record, and delete subordinate logins while retaining care records. The sole Operations owner is protected. Interrupted deletion has a retry state; production Auth deletion was not tested on an existing real account.
- Household invitations are email-bound and consent-checked. Seniors invite/remove family; family can invite the senior for an already linked record and disconnect their own link. Neither can change staff assignments or claim an arbitrary senior.
- Shared follow-ups support requested, assigned, progress, household acknowledgement/completion report, and staff closure with an outcome. Confidential earlier staff tasks remain separate.
- Four bilingual wellbeing questions can record a coordinator call, family report, or optional senior web reply. Answers, note, signal and necessary follow-up save in one database transaction. The web reply is a complement to simple-call intake.
- Conversations address a verified individual recipient with receipt visibility limited by the parent conversation and consent. Operations can send care messages. Recording a simulated SMS/call is labelled separately from carrier delivery.
- Care mutations retain cloud domain records and audits. Authenticated request metadata receipts exclude request bodies, identifiers in URLs, passwords and notes. Operations can inspect cloud record counts and request outcomes. Receipt retention is 90 days; care history is separate. A receipt failure does not misreport an already committed care write as failed.
- n8n report jobs have signed failure receipts, five-minute deadlines, durable failure/timeout states and explicit single-child retry. A claimed timeout requires execution inspection before another model request. Report text must pass saved-evidence checks and human review.

## Data and verified boundaries

The PS requires synthetic showcase data: 200 fictional senior profiles over 90 calendar days, with 17,226 observed daily entries and 18,000 baseline score dates. These remain labelled synthetic. No identifiable real-patient data was injected and no clinical validation is claimed. Genuine consented observations can be entered through the existing dated ingestion forms.

The backend migrations passed rollback tests for household permissions, consent withdrawal, invitation changes, protected account removal, exact-recipient conversations, shared action revisions and report failure/retry states. All fixtures were rolled back. The full automated suite passed 337 cases; TypeScript, the native Next.js build and retained worker build passed. Private local HTTP checks verified wrong-role rejection across all five showcase identities and persisted request receipts.

## Integration acceptance still separate

n8n's existing published workflow was corrected in the UI to use the canonical Vercel claim and callback URLs. All four execution-data saving choices were explicitly set to Do not save and re-opened to verify persistence. Public report generation is enabled using existing credits and the existing encrypted signing secret. A new request from the actual production website received HTTP 202, was claimed, and saved an evidence-checked GPT-5-mini-2025-08-07 report with eight evidence entries as pending_review. It was not approved or sent to family. No automatic second inference was submitted.

The enhanced failure-branch workflow import is prepared privately, preserving existing credential references. Its import/publish requires the browser connection, which became unavailable again after the earlier settings save. Backend timeout/failure controls are deployed independently; do not claim the additional n8n branches are published until the UI confirms it.

Hosted Edge releases are account-admin v2, daily-care v9 and n8n-hooks v6. Six additive migrations are applied, including the null-safe report retry patch. No existing account was deleted or password changed during release verification.

Autonomous carrier calling, Hindi/Hinglish telephone transcription accuracy, continuous motion detection, clinically representative evaluation and full workload cost/load at 10,000 seniors remain unvalidated. Android SMS and local transcription still require their paired device/local services. One historical actual SMS delivery is not evidence that the device is currently connected or that every new message is delivered.
