# Accounts and mobile numbers

The configured workspace has five separate sign-ins:

| Account | Role | Access |
|---|---|---|
| Existing owner | Operations Manager | Sole administrator; all care records, account invitations/revocation, assignments, calls and SMS |
| coordinator@samarth.test | Care Coordinator | Care work, calls and SMS for S001 and S002; no account administration |
| family@samarth.test | Family Member | S001 and S002, with sharing consent checked separately for each senior |
| senior1@samarth.test | Senior Member 1 | S001 only |
| senior2@samarth.test | Senior Member 2 | S002 only |

The four `samarth.test` identities are synthetic showcase logins. Their sign-in passwords are generated independently and retained only in an ignored private access file on the setup computer. They are not real verified email inboxes, recovery destinations or public demo passwords. The administrator's existing password is unchanged. The prior owner memberships for other roles are revoked; changing a role selector cannot restore them.

## Operations account console

Open **Operations Manager → Accounts**. The console provides:

- **Users:** search and filter all registered identities, including users without assigned access. Inspect roles, senior links, account state and masked mobile numbers.
- **Create login:** enter a name/email, choose a role, and select existing senior records. Senior logins link to one senior; family accounts may link to several; coordinators receive selected caseloads or explicitly all seniors. Operations staff created here are not administrators.
- **Assign existing account:** allocate roles or additional senior links to a registered, confirmed identity without changing its password. Existing family links and coordinator caseloads are preserved when adding allocations.
- **Manage:** edit the name and replace the selected role's assignments, suspend or restore access, or explicitly reset a subordinate account's password. Other role assignments remain unchanged.
- **Mobile numbers:** add, replace, remove or change channel permissions using the controls below.

Creation and password reset reveal the newly generated password once, in the administrator's current view. No password is stored in browser storage, the directory, audit events or request receipts. Copy it to the intended recipient through a suitable private channel; the website does not send credential emails/SMS automatically. A lost password must be reset explicitly rather than retrieved. Retrying a completed request does not create another login or disclose the password again.

Suspension and password reset invalidate older care-access tokens, in addition to removing role-selection sessions. Restoring an account requires a fresh sign-in. The sole Operations administrator cannot be suspended, reassigned or password-reset through subordinate account controls.

## Manage account phone numbers

Sign in as Operations Manager, open **Accounts**, then **Mobile numbers & contact permissions**:

1. Choose **Add number** or **Manage** beside the intended account.
2. Enter a mobile number including its country code. To replace a number, enter the complete replacement; the list displays only the masked saved number.
3. Choose SMS and call permissions separately. Confirm the account holder owns the number and agrees to those channels.
4. Save. To change permissions without replacing the number, leave the replacement field unchanged and choose **Save permissions**.
5. **Remove number → Confirm removal** disables future account calls/SMS. It does not send a test message.

No real mobile numbers were assigned during account provisioning. The user will provide them. Administrator confirmation is recorded; it is not claimed as an OTP or carrier ownership check. Contact management never marks a message delivered or a call answered.

The same family mobile can serve both linked seniors. Staff contacts are associated with the actively registered senior accounts within their assignment. The calling/SMS screen resolves the active account and current contact version, not an arbitrary typed destination. Replacing/removing a number, withdrawing a channel permission or revoking membership makes stale contacts unavailable for new dispatch. Existing delivery receipts remain historical evidence.

Care coordinators can request calls and SMS for their assigned contacts, but cannot change account phone bindings. Seniors/family cannot inspect the staff phone directory or change another account. Raw telephone numbers stay out of the normal contact list responses. Family-sharing consent is independent of telephone channel permission and is checked again before family contact.

## Family access and reports

The family page includes a linked-senior selector. Summary requests and conversations remain bound to the selected senior; a delayed response from one senior is not shown under the other. Newly provisioned family users do not inherit someone else's inbox. Where no approved report has been delivered to that family identity, the page shows an unavailable/pending state instead of inventing an update.

## Validation

`tests/account-admin.test.mjs` checks provisioning input, live administrator verification, existing-email protection, one-time password handling and request replay. `tests/account-console-hosted-rollback.sql` verifies allocation, replacement, suspension/restoration, token invalidation and sole-admin protection in a rolled-back hosted transaction. Phone and hierarchy checks remain in `tests/account-routes.test.mjs`, `tests/access.test.mjs` and `tests/account-hierarchy-hosted-rollback.sql`. No test SMS/call is sent.

The protected `account-setup` Edge Function can provision only the four fixed synthetic identities after verifying the current Operations administrator. Existing passwords are never reset by this action; arbitrary account addresses or administrator grants are not accepted. Its privileged service credentials remain inside Supabase.
