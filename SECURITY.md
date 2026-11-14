# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately**. Do not open a public issue, pull request or discussion that describes the problem.

1. Go to this repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting). This opens a private security advisory that only the maintainers can see.
2. Include what is affected (file, route, table or policy), steps to reproduce, the impact you expect, and any proof of concept. Never include real user data or live credentials.
3. If the **Report a vulnerability** button is not shown, open a public issue titled "Security contact request" with **no details** of the problem, and a maintainer will set up a private channel.

What to expect: an acknowledgement on the advisory, an assessment of severity, and a fix in a private fork of the advisory where needed. Please give us a reasonable time to ship a fix before any public disclosure. We will credit you in the advisory unless you ask us not to.

## Supported versions

This is a continuously deployed app with no released packages.

| Version | Supported |
| --- | --- |
| `main` (the current production deployment) | yes |
| Any older commit, branch or preview deployment | no |

Fixes land on `main` only.

## Scope

In scope:

- The Next.js app in `src/` (pages, route handlers, middleware, the data layer in `src/lib`), including the auth callback.
- The database schema, Row Level Security policies, functions and grants in `supabase/migrations`, and the access rules they implement (`contracts/rls.md`): for example reading or changing a list you were not shared on, escalating your role, or matching a membership with an unconfirmed or forged email.
- Realtime events that reach users who should not receive them (`contracts/realtime.md`).
- The GitHub Actions workflows in `.github/workflows`.
- Vulnerable dependencies that are reachable from this app.

Out of scope:

- Supabase, Vercel or GitHub platform vulnerabilities themselves (report those to the vendor).
- Behaviour documented as intentional: collaborators on a list can see each other's emails; Realtime DELETE events carry only a random row id (see `contracts/realtime.md`).
- Denial of service through volume, rate-limit exhaustion of the hosted project, social engineering and physical attacks.
- Findings that need a compromised account, device or Supabase service-role key.
- Reports from automated scanners without a demonstrated impact on this app.

The current internal review is in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).
