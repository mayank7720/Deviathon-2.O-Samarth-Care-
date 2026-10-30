# Weekly summary management

The staff Weekly AI summaries page now follows preparation, evidence inspection, review and recipient selection. Generated report text remains immutable. Review decisions, internal notes and publication history are separate cloud records.

## Available controls

- Select a senior, language, model/computed method and a seven-day period ending on a date within available history. Latest/previous-week shortcuts are provided.
- Inspect usable days, missing days, source-entry counts, domain coverage and supported statements before submitting a generation request. Empty weeks are blocked before inference.
- Reuse matching saved output/active attempts by default. The explicit new-version control preserves the original and permits a new generation; AI versions consume another model request. Idempotency keys cannot switch their senior, language or reporting week.
- Search report text/date/reference; sort by creation or reporting week; filter active, needs-review, reviewed, shared, failed, rejected and archived records. Refresh manually or poll while the page is visible.
- Save internal notes. Mark reviewed only after checking source evidence, uncertainty and absence of diagnoses/medication-change recommendations. Reject with a reason, or reopen the review. A stale revision requires loading the latest saved review and does not overwrite another staff member's work.
- Choose named, active linked family recipients. Share exactly the reviewed saved version to their secure inboxes in one transaction; current consent and membership are rechecked. A recipient failure rolls back all selected publications. Repeating a request does not send another copy.
- Withdraw family copies with a recorded reason. Rejection also withdraws shared copies and blocks pending publication. Copies already downloaded/read cannot be recalled.
- Archive/restore reports without deleting evidence, audit history or existing family copies.
- Copy, download text or print/save PDF for the selected report. Internal notes, recipient details and audit records are excluded.
- Inspect saved review activity, individual inbox publication/read status, failed-attempt reasons and explicitly permitted retries. Recheck the n8n connection separately from report generation.

## Implementation and verification

`care_report_management` exposes narrow staff RPCs backed by private RLS-enabled review/audit tables. All mutations require current senior scope, a report revision and an idempotency key. The family inbox still requires current sharing consent and delivered/read status. The database sharing trigger prevents the older delivery route or a late processor from republishing an unreviewed, rejected or withdrawn generated report.

Historical week generation uses the score/reference available at that period's end; when historical scoring is unavailable the report retains unknown priority and omits personal comparisons rather than reusing future state. Only masked computed facts reach n8n. Report text, source evidence and model provenance remain preserved.

515 automated tests passed, including date isolation, explicit versions, empty-week rejection, management validation, retry behavior and privacy of text exports. TypeScript, targeted ESLint and production build passed. Hosted rollback fixtures cover the checklist, role/revision rejection, named recipients, atomic publication, idempotency, family visibility, archive/restore, withdrawal and rejection. No real-family review/share/withdrawal and no new inference or carrier message were performed by this release's checks. Browser control remains unavailable; visual browser acceptance and a user-initiated native print dialog are not claimed.

This is an explicit staff generation/review workflow. It does not add automatic weekly inference, scheduled family delivery, arbitrary bulk model requests or automatic approval.

Production deployment `dpl_wHq5FW7vQYde4ojBgxrcorishiGs` is promoted at https://swasthsync.vercel.app/. Its 302 runtime files have SHA-256 `9aa6441225f225f6fd194ec2228e6699cf7612e2ad13e2b9d77e7b818a8e0919`. Migration `20261030202538_weekly_report_management` is installed. Public post-deploy checks confirmed staff access, named eligible recipients, evidence preview, rejection of future dates and unsupported deletion, and preservation of the existing actual model draft pending review. General sign-in, links, monitoring and calling configuration checks also passed. The n8n workflow, model and scoring-worker versions are unchanged.
