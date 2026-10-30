# Security and sensitive data

SwasthSync is a student prototype using fictional care records. It has not completed a production security or clinical validation programme.

## Reporting

Do not put credentials, private phone numbers, health records, account passwords or exploitable details into a public issue. Use the repository owner's GitHub contact or private vulnerability reporting if available to arrange private disclosure. Public issues may describe a redacted symptom or non-sensitive documentation problem.

## Boundaries

- Operations manages staff access. Selecting a portal or changing user metadata never grants that role.
- Normal user traffic uses a verified session and current scoped database policies. Secret/service-role credentials belong only in protected background services.
- Keep family sharing, communication consent and actual account numbers current. Delivery is separate from human response.
- Real passwords are not retrievable from password hashes. Account management uses reset/change/provisioning workflows; do not store plaintext passwords for an administrator to view.
- External report input is whitelisted and masked. Masked health aggregates remain sensitive.
- Keep `.env.local`, `.dev.vars*`, API credentials, receiver secrets, private outputs and recordings out of source control. `.env.example` intentionally contains placeholders only.
- Use a disposable project for destructive or rollback database tests. Keep local fixture authentication on loopback.

## Operational limits

Signed requests, role checks and automated regressions do not constitute a completed audit. Accessibility, retention, recovery, threat modelling, provider governance and scale testing remain required before real care use. The project has no official emergency dispatch or guaranteed response capability.
