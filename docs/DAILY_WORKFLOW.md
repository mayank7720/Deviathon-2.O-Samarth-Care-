# Daily care workflow and free delivery

The workspace clock defaults to replaying 27 October 2026. An administrator can select an earlier day inside the synthetic history, or switch to the live date in Asia/Kolkata. Live mode advances data freshness; it does not invent observations. Daily scores retain `null` and an explicit unknown priority when the records do not establish wellbeing.

The daily job writes per-senior, per-day cache rows, records the first time an alert was observed, and creates a persistent delivery outbox. Repeating the same job with the same signal and consent revision reuses the result. New evidence can run the workflow again; stable recipient and source identifiers prevent a second copy of the same message even if a membership is duplicated or replaced.

Serious changes create immediate in-app alerts for assigned care staff and consented, linked family members. Unknown data creates a coordinator check-in alert; it does not create a serious family notification. Routine family communication is grouped into a weekly draft. The coordinator must inspect and approve each weekly delivery before it can be processed. Family and senior cache responses contain a pending-review placeholder rather than the draft. Approved updates appear in the recipient's care inbox.

Only delivered in-app messages can be marked read, by their actual recipient and role. A push-service acceptance is recorded as delivered to the push service, not as proof that a person saw or acted on the message. Family access and consent are checked again when listing, approving, processing and reading deliveries. Withdrawal hides previous family deliveries and blocks unsent ones. Revoked membership prevents further delivery.

Browser push is optional. Enrollment happens only after the person presses the subscription button and permits notifications. VAPID keys stay in server configuration. Requests are restricted to supported HTTPS browser-push endpoints, use encrypted payloads, disallow redirects, and send only the generic text “Samarth Care update — open your care inbox.” Names, notes, vitals and diagnoses never enter push payloads. Network failures remain visible with a bounded retry count; expired subscriptions are disabled. The service worker opens the authenticated app.

Each processing attempt claims a delivery atomically for five minutes. Concurrent processors cannot dispatch the same active lease; an interrupted worker can be retried after the lease expires, within the three-attempt limit. Browser push remains an at-least-once delivery channel: if a worker stops after a provider accepts a message but before the database records success, a retry can repeat that generic notification. The stable notification tag allows the browser to replace the previous notice. A completed network send does not prove that the person read it.

In-app delivery and the local model require no paid AI or telecom provider. Actual telephone-network calls and SMS are separate integrations and are not supplied by browser push. Browser notifications require a supported browser, secure origin (or localhost), granted permission and configured VAPID keys. Delivery to an actual external browser subscription requires a real-device integration check.

Operations reports distinguish first acknowledged response from completed care actions. Unacknowledged alerts have no response duration. A completed task does not retroactively invent an acknowledgment. City and team figures use recorded events; the present showcase has one primary team.

## Bounded-cache benchmark

Run `node scripts/benchmark-cache.mjs` from the repository root to generate `outputs/cache-benchmark.json`. It inserts 10,000 compact synthetic score-cache rows and checks indexed, bounded pages of 250, including lossless pagination. This is a local SQLite cache-read benchmark. It does not establish full-model throughput, cloud concurrency, production health-data storage costs or free-tier affordability at that population.
