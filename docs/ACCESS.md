# Access and invitations

**Current Supabase/Vercel setup:** Operations Manager is the sole administrator, with separate coordinator, family and two senior logins. See [Accounts and mobile numbers](ACCOUNTS.md) for the current hierarchy and phone management. The Sites/D1 owner setup below describes the earlier hosting checkpoint and must not be used to provision the current workspace.

The hosted landing page is public. Care records and mutations are protected by verified Sites identity, active D1 membership, assigned role and senior scope. There is no shared password list. Signing in establishes identity; it does not grant an ordinary visitor a care role.

## Owner's first sign-in

The deployment's server-only `SAMARTH_BOOTSTRAP_OWNER_EMAIL` setting identifies the actual site owner's verified account email. Its value is not committed or exposed in browser code. On that owner's first hosted sign-in, the server initializes the workspace and assigns four showcase memberships:

| Assigned role | Showcase access |
| --- | --- |
| Care Coordinator | Care queue, scoped signals, tasks, alerts, communications and analysis |
| Operations Manager | Scoped operational views, outcomes and analysis; no care-record writes |
| Senior Member | Linked senior S001 check-ins, own prompts and care conversations |
| Family Member | Linked senior S001 information and conversations only with current family-sharing consent |

The configured owner has administrator privileges for access management. The **Assigned care role** selector changes between already assigned memberships; it cannot grant an unassigned role. A single owner account changing roles does not become a second voice-call identity.

If the owner sees “invitation required” or “setup required,” verify the signed-in email and server bootstrap configuration. Do not make an arbitrary visitor the owner or place the bootstrap value in client code. Bootstrap initializes an absent workspace; changing the setting is not an ownership-transfer workflow.

## Invite another person

1. Enter the coordinator workspace as an owner administrator and open **Access & invitations**.
2. Enter the person's verified account email and select the role. For senior or family access, select the linked senior.
3. Choose **Create invitation link**. The app generates an email-bound token and shows the link. **No email is sent.**
4. Copy and manually share it with the intended person through an appropriate channel. The app does not send a message on your behalf.
5. The recipient opens the link, signs in with the exact invited email, and chooses **Accept invitation**. Wrong-email, expired or previously used links are rejected.

Invitations expire after seven days and are single-use. The database stores a SHA-256 token hash, not the link's raw token. Do not publish or include invitation URLs in screenshots. Create another invitation if an unused one expires. Membership grants are distinct from site-level sharing: preserve the Site's existing audience; do not relax its settings to bypass assignment checks.

## Scope, revocation and consent

Each protected request checks the current membership. Senior/family memberships link to a specific person. Staff memberships support assigned senior scopes; the owner invite form currently creates workspace staff access, while the API can assign explicit senior IDs. Revoking another member disables subsequent protected access. The owner cannot revoke their own workspace membership through this action.

Membership and family-sharing consent are separate. A family member can remain assigned while consent blocks that senior's records, summary, serious alerts, inbox and voice signaling. Consent revocation is checked on each subsequent request. Already viewed data cannot be recalled from a person's memory or copied files. Active voice clients poll access and stop local media when denied; this is not a claim of instantaneous network-wide recall.

## Local development fixtures

When the server explicitly runs in development mode on loopback (`localhost`, `127.0.0.1` or `::1`), the landing page offers four fixture-role entries. Choose **Open local demo** to enter a specific account. Sign out to enter another fixture. The local coordinator fixture is administrator; senior/family fixtures link to S001. They are synthetic testing accounts, not real users or reusable passwords.

Local login endpoints are unavailable on hosted requests. Copying a role name into a selector or changing a hosted cookie does not create a membership. Local and hosted D1 data are separate; `npm run db:init` applies local migrations only.

## Security and deployment boundaries

Sites supplies verified hosted identity headers at the platform boundary. Do not run this Worker publicly behind an arbitrary proxy that permits callers to forge those headers. Role tests exercise assigned access, senior scope and consent; they do not replace a deployment security review or health-data compliance program. Use fictional information throughout this showcase.
