# Account and household access

Operations is the only administrator. Public account registration accepts `family` and `senior`; a requested role is only registration intent. Verified email plus an active stored membership is required for care access. Staff accounts and care assignments are provisioned by Operations.

`POST /auth/login` requires `{email,password,role}`. A valid password at the wrong portal returns 403, clears browser authentication and role-selection cookies, and revokes only the newly created provider session. User metadata cannot authorize a role. Verified people without any membership may sign in to a family or senior portal to accept an invitation; they cannot view care data.

## Household links

Family and senior portals use `GET /household`, `POST /household/invitations`, `DELETE /household/invitations/:id`, and confirmed `DELETE /household/links/:id`. Database transactions verify the caller's active role and existing senior scope. Invitation links are email-bound, expire after seven days and are stored as hashes. The recipient must sign in with the matching verified email. Self-invitations are rejected. Consent is checked both when creating and accepting a household invitation.

A senior can invite or disconnect family for their own record. A family can invite a senior only for a record already linked to that family; it cannot claim another record or replace another senior's existing login. A family disconnect removes its own family membership for that senior. It never deletes the senior identity or modifies coordinator assignments. New, unlinked senior records require Operations verification. Sharing consent continues to govern family access after linking.

## Invitations and deletion

The Operations console can create, edit, revoke and remove invitations from its history. Editing replaces the secret and invalidates its old URL. Removing a pending invitation revokes it. Removing an accepted invitation from history preserves its granted membership; account access is changed in Users. Every change has an audit event, and history removal retains the database row.

`DELETE /accounts/:id` requires `confirmDelete:true` and a stable UUID `idempotencyKey`. The server verifies Operations access, disables the target account, revokes memberships, selected-role sessions, push subscriptions and contact permissions, then performs an Auth **soft deletion**. The Auth primary key and care records remain to preserve provenance. Old JWTs immediately lose care access through account-state and membership checks. The sole Operations owner cannot be removed. Deleted identities cannot be restored through account editing.

If provider deletion is interrupted, access stays disabled and the directory shows **Deletion pending**. Retrying the same request safely finishes it. A completed replay never deletes another account or issues credentials. Removing a household link and deleting a login are separate actions. No account passwords, patient records or phone numbers are included in invitation audit events.

## Validation

`tests/supabase-auth.test.mjs` covers all 16 assigned-role/selected-portal combinations, disabled/stale sessions, membership lookup failure, unassigned accounts and public registration limits. Household and account-admin tests check endpoint scope, token handling, confirmation, owner protection and deletion ordering. `tests/portal-access-hosted-rollback.sql` verifies database policies using temporary synthetic identities and an existing Operations owner. It rolls back every fixture and makes no Auth, email, phone or SMS requests.
