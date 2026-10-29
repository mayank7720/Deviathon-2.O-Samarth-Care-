# Account-driven notification routing

A saved mobile belongs to the person who owns that login. It is a notification destination, not a sender ID or a new care assignment. Number confirmation and SMS/call permissions are separate from the senior's family-sharing consent.

| Recipient | Automatic notification purposes |
|---|---|
| Assigned coordinator | Household support requests, member follow-up responses, serious review flags and messages addressed to that coordinator |
| Operations owner | Unassigned support requests and overdue care requests; messages explicitly addressed to Operations |
| Linked senior | Missing-information check-in reminders and shared follow-up progress |
| Consented linked family | Serious review flags, shared follow-up progress and a notice after weekly-summary approval |

The coordinator is selected from actual active account memberships. An explicitly assigned follow-up owner wins; otherwise the earliest active assigned coordinator is the deterministic primary. The sole active Operations owner is the fallback when no coordinator is assigned. The illustrative care-planning roster cannot grant a recipient access. Unrelated coordinators never receive the request. A family with several senior links is evaluated separately for every senior and its current sharing consent.

## Durable events and dispatch

Database triggers commit a generic protected-inbox notice and a `care_notification_routes` intent with the originating care event. A family or senior does not need staff privileges to cause the permitted support notification. Notification generation does not depend on a coordinator first loading the dashboard. Current assignments, consent and account state govern recipients.

SMS dispatch occurs when an authorized Android relay polls. `care_notification_routing('process',{})` resolves the account's **current** confirmed mobile and SMS permission, then queues the existing fixed-template Android job. The normal signed claim, bounded lease and factual device-receipt rules still apply. The daily processor calls `reconcile` to recover unassigned/overdue requests; its service context does not originate telephone jobs.

An intent without a number or SMS permission stays `awaiting_contact`; it does not invent a destination or fall back to a family number. Replacing a mobile cancels an unsent stale job and allocates a job for the new contact revision. Permission withdrawal, account suspension, family-consent withdrawal or a changed follow-up owner prevents a new claim. A previously submitted carrier message cannot be unsent; its existing receipt is retained.

SMS copy is generic. Notes, readings, names, email addresses, diagnoses and phone numbers are not placed in notification text. Staff prompts ask the staff member to inspect the queue; they never instruct a coordinator to contact their own coordinator. Routine repeats of the same notification type have a 15-minute cooldown and each recipient has a ten-SMS-intent daily limit. The protected in-app notice remains available during cooldown. Unclaimed device jobs expire after 30 minutes and are not automatically redialled or resent.

`GET /telephony/routing` exposes scoped intent states and safe reasons. Queued, accepted, sent and delivered are distinct states; no state establishes a human read or answered call.

## Calls and relay scope

A household's request for a call sends the assigned care staff a support notice. It does **not** dial the staff phone or automatically call the senior. An assisted call opens a dialer and requires a person to press Call. A four-question wellbeing bot may target only the senior account; call permission does not authorize a family or coordinator bot interview.

Both local relay clients accept `SAMARTH_RELAY_ROLE=coordinator|operations`, defaulting to `coordinator`. The configured login must already possess that role and the required scope. A coordinator relay serves only its caseload. The Operations owner can operate the relay for the whole workspace using its assigned Operations identity. Selecting this setting never grants a role or bypasses authentication. No private configuration or running phone process is changed by the code update.

## Verification

The hosted rollback regression covers atomic support routing, exact primary coordinator selection, unrelated-recipient exclusion, current-phone replacement, channel withdrawal, duplicate processing, a family's second senior and reviewed-summary gating. All fixtures roll back and no gateway is contacted. Node tests cover role-specific templates, senior-only call bots and relay-role validation. These tests verify routing logic; actual delivery additionally requires the paired device, configured relay and carrier plan.
