# Security Review

Run `tododemosh-9023`, task T8 (security gate). Reviewed on 2026-11-14.

## Scope and baseline

Reviewed by reading the code at `main` = `f5d89cc` (PR #5), plus `src/middleware.ts` from PR #4, which merged to `main` as `f140406` while this review was running (read through the GitHub API).

| Area | Files | Reviewed |
| --- | --- | --- |
| Schema, RLS, functions, grants | `supabase/migrations/20260101000000_init.sql`, `supabase/tests/verify.sql`, `docs/DATABASE.md` | yes |
| Contracts | `contracts/rls.md`, `contracts/realtime.md`, `contracts/data-model.md`, `contracts/data-api.md` | yes |
| Supabase clients | `src/lib/supabase/{client,server,env}.ts`, `.env.example`, `.gitignore` | yes |
| Session middleware | `src/middleware.ts` (PR #4, merged) | yes, first pass |
| Data layer | `src/lib/lists`, `src/lib/sharing` (PR #6, open) | **no**, still in review (see the re-review list) |
| UI and `src/app/auth/callback` | not on `main` yet | **no** (see the re-review list) |
| Workflows | `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml` | yes |
| Dependencies | `package.json`, `package-lock.json` (`npm audit --omit=dev`) | yes |
| Repo settings | read-only `gh api` calls | yes |

**Result: 0 critical, 0 high, 3 medium, 6 low, 8 info.** No high or critical finding is open.

## Findings

Severity: critical / high / medium / low / info. Status: `open` (action needed), `accepted` (known, by design, or not reachable), `ok` (reviewed, no issue).

| ID | Severity | Location | Owner | Status |
| --- | --- | --- | --- | --- |
| SR-01 | medium | Supabase Auth settings; `public.list_role`, `public.my_member_id` | db (T4), deploy | open |
| SR-02 | medium | Realtime assumption A2, `contracts/realtime.md` | db (T4), data (T5) | open |
| SR-03 | medium | Repo setting: private vulnerability reporting | orchestrator (repo admin) | open |
| SR-04 | low | Realtime assumption A1 (DELETE events) | contracts (T1), data (T5) | accepted |
| SR-05 | low | `list_members_select` policy | contracts (T1), ui | accepted |
| SR-06 | low | `postcss@8.4.31` bundled by `next@15.5.29` | scaffold (T2) | accepted |
| SR-07 | low | `next.config.mjs` (no security headers) | scaffold (T2), ui | open |
| SR-08 | low | No row quotas; anonymous sign-ins | db (T4), deploy | open |
| SR-09 | low | Repo setting: Dependabot security updates | orchestrator (repo admin) | open |
| SR-10 | info | Workflows pin actions by tag, not SHA | ci (T3), security-gate (T8) | accepted |
| SR-11 | info | Client-chosen primary keys on INSERT | db (T4) | accepted |
| SR-12 | info | `public.reorder_todos` takes no lock | db (T4) | accepted |
| SR-13 | info | Realtime channels are public channels | data (T5) | accepted |
| SR-14 | info | Migration: RLS, DEFINER functions, grants, email lookup, timestamps | db (T4) | ok |
| SR-15 | info | `src/lib/supabase/*`, env, secrets | scaffold (T2) | ok |
| SR-16 | info | `src/middleware.ts` | session (T12) | ok |
| SR-17 | info | `.github/workflows/ci.yml`, `codeql.yml` | ci (T3), security-gate (T8) | ok |

### SR-01 (medium) Sharing depends on Supabase email confirmation being on

- **Location:** Supabase Dashboard > Authentication; `list_role` and `my_member_id` in the migration.
- **Description:** A member row grants access to whoever has a *confirmed* `auth.users.email` equal to `list_members.email`. The SQL does this correctly. But if "Confirm email" is off (`mailer_autoconfirm`), Supabase sets `email_confirmed_at` at signup and applies email changes without confirmation. An attacker could then sign up with a password, or change their email, to a victim's address and inherit every list shared with the victim. That includes shares created before the victim has an account. The safeguard is a dashboard setting that the repo cannot enforce.
- **Recommendation:** Keep "Confirm email" **on** and "Secure email change" **on**. Prefer magic link only: if password signups are not needed, disable them. Add these settings as a hard item in the deploy checklist (`docs/DEPLOY.md`) and check them before go-live.
- **Status:** open. `docs/DATABASE.md` already requires "Confirm email: ON". The setting on the live project was not checked.

### SR-02 (medium) Realtime A2 is unverified: INSERT and UPDATE events reaching only members

- **Location:** `contracts/realtime.md` assumption A2; `public.list_role` (SECURITY DEFINER) used by every SELECT policy.
- **Description:** Realtime applies the SELECT policies to each subscriber's INSERT and UPDATE events. That is safe only if `auth.uid()` inside the DEFINER function sees the subscriber's JWT claims. It should, because SECURITY DEFINER switches the role but not the `request.jwt.claims` setting. This has not been tested against a live Realtime server. If A2 is false, todo titles and member emails would reach non-members, and this finding becomes **high**.
- **Recommendation:** Before production, run the "data" verification in `contracts/realtime.md` (A, B as editor, C as non-member, plus a viewer and an unconfirmed-email user) on a local or dev Supabase. Record the result in `docs/DATABASE.md`.
- **Status:** open (verification pending).

### SR-03 (medium) Private vulnerability reporting is disabled

- **Location:** repository settings. `gh api repos/TheCoder30ec4/TODODEMO-Skill-Test/private-vulnerability-reporting` returns `{"enabled":false}`.
- **Description:** `SECURITY.md` asks reporters to use GitHub private vulnerability reporting. While it is off, the "Report a vulnerability" button is missing, and reporters only have the fallback of a detail-free public issue. The repo is public.
- **Recommendation:** A repo admin enables it with `gh api -X PUT repos/TheCoder30ec4/TODODEMO-Skill-Test/private-vulnerability-reporting`, or in Settings > Code security > Private vulnerability reporting.
- **Status:** open. Out of T8's boundary (no settings changes).

### SR-04 (low) Realtime DELETE events leak row ids and timing across lists (A1)

- **Location:** `contracts/realtime.md` rows 2, 5 and 8, assumption A1.
- **Description:** If A1 holds, every subscriber receives `{ id }` for every DELETE on `lists`, `todos` and `list_members` across all lists. The ids are random uuids and carry no titles or emails. A subscriber still learns the volume and timing of deletes app-wide.
- **Recommendation:** Accept for this app. If it matters later, move deletes to private channels with Realtime Authorization (for example a trigger that broadcasts to a `list:{id}` topic). Keep replica identity at default, so `old` stays `{ id }`. Confirm A1 in the same live test as SR-02.
- **Status:** accepted (documented in `contracts/realtime.md` and the README). A1 itself is unverified.

### SR-05 (low) Collaborators see each other's emails

- **Location:** `list_members_select` policy (`using (public.list_role(list_id) is not null)`), `listMembers`.
- **Description:** Viewers and editors can read every member email on lists they belong to, through queries and Realtime. Non-members see none.
- **Recommendation:** Keep it as designed (`contracts/rls.md`). The UI should show emails only inside the list's sharing view, never in URLs, logs or analytics.
- **Status:** accepted (by design).

### SR-06 (low) `npm audit --omit=dev`: vulnerable PostCSS bundled with Next

- **Location:** `node_modules/postcss@8.4.31`, which is an exact dependency of `next@15.5.29`.
- **Description:** `npm audit --omit=dev` reports 1 high (`postcss`) and 1 moderate (`next`, through postcss):
  - GHSA-qx2v-qp2m-jg93: XSS through an unescaped `</style>` in stringify output (`<8.5.10`).
  - GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849: arbitrary `.map` file read through an attacker-controlled `sourceMappingURL` (`<=8.5.22`).

  **Not reachable:** Next runs PostCSS only at build time, on the repo's own CSS (`src/app/globals.css`). The app never parses or stringifies user-supplied CSS. `@supabase/ssr` and `@supabase/supabase-js` have no advisories. The dev-only `postcss@8.5.32` under vite is outside the affected ranges.
- **Recommendation:** Pick it up with the Next 16 upgrade (Dependabot PR #11, semver major, needs its own review). Do not force an `overrides` entry against Next's exact pin.
- **Status:** accepted (not reachable). Re-run the audit after PR #11.

### SR-07 (low) No HTTP security headers

- **Location:** `next.config.mjs` (empty config).
- **Description:** There is no `Content-Security-Policy`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options` or `Permissions-Policy`. That allows clickjacking of the share and delete actions, and gives no defence in depth against XSS. Vercel adds HSTS on its domains.
- **Recommendation:** Add `headers()` in `next.config.mjs`: `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and a CSP that allows `connect-src` to the Supabase URL (`https:` and `wss:`).
- **Status:** open (change request for scaffold/ui).

### SR-08 (low) No quotas; anonymous sign-ins would count as `authenticated`

- **Location:** INSERT policies on all three tables; Supabase Auth settings.
- **Description:** Any signed-in user can create unlimited lists, todos and member rows. If Supabase anonymous sign-ins were enabled, anonymous users would get the `authenticated` role and could create lists. They would not get shared access, because they have no confirmed email.
- **Recommendation:** Keep anonymous sign-ins **off** and document it in the deploy checklist. Optionally cap rows per owner with a trigger or CHECK if abuse appears.
- **Status:** open (config and docs item).

### SR-09 (low) Dependabot security updates are disabled

- **Location:** repository settings (`security_and_analysis.dependabot_security_updates: disabled`). Dependabot alerts are enabled (`GET .../vulnerability-alerts` returns 204), and version updates run weekly through `.github/dependabot.yml`.
- **Recommendation:** A repo admin enables automated security fixes (`gh api -X PUT repos/TheCoder30ec4/TODODEMO-Skill-Test/automated-security-fixes`).
- **Status:** open (settings change, outside T8's boundary).

### SR-10 (info) Actions pinned by tag, not commit SHA

- **Location:** `ci.yml` (`actions/checkout@v7.0.1`, `actions/setup-node@v7.1.0`) and `codeql.yml` (`actions/checkout@v7.0.1`, `github/codeql-action/*@v4.39.3`).
- **Description:** A moved or compromised tag would run new code. Each job has read-only `contents` permission and no secrets, which limits the impact. All four tags were verified to exist with `gh api repos/<owner>/<repo>/git/matching-refs/tags/<tag>`.
- **Recommendation:** Optionally pin to full SHAs with a `# vX.Y.Z` comment. Dependabot (`github-actions` ecosystem) keeps either form updated.
- **Status:** accepted (matches the repo convention).

### SR-11 (info) Clients can choose primary keys on INSERT

- **Location:** `grant select, insert, delete on public.lists, public.todos, public.list_members to authenticated` (table-level INSERT includes `id`).
- **Description:** A client can insert with an explicit `id`. A `23505` error then tells it that a guessed uuid already exists. Guessing a random v4 uuid is infeasible, and the ids exposed by A1 belong to deleted rows.
- **Recommendation:** None needed. Column-level INSERT grants that exclude `id` would close it if wanted.
- **Status:** accepted.

### SR-12 (info) `reorder_todos` takes no lock

- **Location:** `public.reorder_todos`.
- **Description:** A todo inserted between the set check and the UPDATE keeps its own position, which can create a tie. This is a correctness edge only: render order breaks ties by `createdAt`, then `id`, and authorization still goes through RLS (SECURITY INVOKER) plus the `list_role` gate.
- **Status:** accepted.

### SR-13 (info) Realtime channels are public

- **Location:** `list:{listId}` channels (`contracts/realtime.md`; T13 / PR #7 amends the naming).
- **Description:** `postgres_changes` is filtered by RLS (subject to A2). But anyone with the anon key can join a public channel by name and send or receive **broadcast** and **presence** messages on it.
- **Recommendation:** Do not use broadcast or presence on these channels unless they become private channels with Realtime Authorization policies.
- **Status:** accepted (only `postgres_changes` is used).

### SR-14 (info) Migration review: no issues found

Checked in `supabase/migrations/20260101000000_init.sql`. `verify.sql` covers most of this, and those checks passed on a stubbed Postgres.

- **RLS** is enabled on all three tables. Every policy is `TO authenticated`, so `anon` has no access. FORCE RLS is off on purpose, so the DEFINER helpers owned by `postgres` bypass RLS without recursion.
- **SECURITY DEFINER functions** (`list_role`, `my_member_id`):
  - Both set `search_path = ''`, qualify every name, are owned by `postgres`, and have EXECUTE revoked from `public` and `anon`.
  - Both return data only about the caller. `list_role` gives NULL for a list that does not exist and for a non-member alike, so it is not an existence oracle.
  - Calling `my_member_id` over RPC with a made-up `lists` row returns at most the caller's own member id.
  - Owner wins: a member row can never yield `'owner'`.
- **Confirmed-email lookup:** `lower(u.email)` comes from `auth.users` with `email_confirmed_at is not null`. `auth.jwt()->>'email'` is never used. Emails are stored lowercased (CHECK) and are unique per list.
- **Grants:**
  - Revoke-all first.
  - Then `SELECT/INSERT/DELETE` and column-level UPDATE only: `lists.title`; `todos.title, done, position`; `list_members.role`.
  - `owner_id`, `list_id`, `email`, `created_by`, `added_by` and the timestamps cannot be updated.
  - INSERT policies pin `owner_id`, `created_by` and `added_by` to `auth.uid()`.
- **Timestamps:** BEFORE INSERT OR UPDATE triggers force `created_at` and `updated_at` to server time, so spoofed values are overridden. The trigger functions are INVOKER with no EXECUTE grant, which is not needed when the trigger fires.
- **`reorder_todos`:** INVOKER (RLS applies), checks the role first, compares the exact id set (cardinality, distinct, membership), and raises `P0001`. The array size is compared before any per-element work.

**Status:** ok. The caveat is that none of this has been run on real Supabase (see "Not verified").

### SR-15 (info) Supabase clients and secrets: no issues found

- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist (`.env.example`, `env.ts`). Both are meant to be public.
- No service-role key, `SUPABASE_SERVICE_ROLE_KEY` or `sb_secret_*` appears in the tree or the git history. Checked with `git log --all -p`; the only matches were lockfile integrity hashes.
- `.env` and `.env.*` are gitignored. Repo secret scanning and push protection are enabled.
- `env.ts` throws at production runtime when env vars are missing, and uses inert placeholders only during build, dev and test.

**Status:** ok.

### SR-16 (info) Session middleware (PR #4): first pass, no issues found

- `src/middleware.ts` calls `supabase.auth.getUser()`, which validates the token with the Auth server, rather than `getSession()`.
- It copies `@supabase/ssr`'s cache headers onto refreshed responses, so a `Set-Cookie` response stays out of shared caches. It does not redirect, so there is no open redirect.
- It is not used for authorization; RLS is. That also makes the class of CVE-2025-29927 middleware bypass irrelevant, and Next 15.5.29 is patched for it anyway.
- Cost: one Auth round trip per matched request.

**Status:** ok. It gets a second pass together with the auth callback (see the re-review list).

### SR-17 (info) Workflows: no issues found

- `ci.yml` and `codeql.yml` use workflow `permissions: contents: read`. Only the `codeql` job adds `security-events: write` and `actions: read`.
- Both use `persist-credentials: false`, set timeouts, use no secrets, and there is no `pull_request_target` anywhere.
- In `codeql.yml`, `cancel-in-progress` is on only for `pull_request`, so pushes to `main` and the weekly scan always finish.
- Code scanning default setup is `not-configured`, so this advanced workflow will not conflict with it.

**Status:** ok.

## Re-review when these merge

**Data layer (PR #6, T5)**

- [ ] No service-role key, `supabase.auth.admin`, or reads of `auth.users`. All access goes through the user's session client (a first grep of the PR diff found none).
- [ ] **Email enumeration via `shareList`:** the only `Conflict` cases are "already a member of this list" and "the owner's own email". Nothing reveals whether an email has an account, and errors and timing are the same either way.
- [ ] Non-members always get `NotFound` (access gate step 2), never `Forbidden`, so list ids cannot be probed.
- [ ] Inputs are validated before any DB call. No string-built PostgREST filters from user input (`.or()` or `.filter()` with interpolated strings).
- [ ] Realtime follows `contracts/realtime.md` (and the T13 amendment): emails are never compared client-side, `removeAllChannels()` runs before `signOut()`, and payloads are mapped before they reach handlers.
- [ ] `getUser()` (not `getSession()`) is used for every "who am I" decision on the server.

**UI and auth (`src/app/auth/callback`, sign-in, list pages)**

- [ ] **Open redirect in `/auth/callback`:**
  - `next` or `redirectTo` must be a same-origin relative path. Reject `//host`, `/\host`, absolute URLs and `javascript:`.
  - Build the redirect from `request.nextUrl.origin` (or a fixed site URL), not from `x-forwarded-host` without an allowlist.
- [ ] The callback uses `exchangeCodeForSession` (PKCE) or `verifyOtp` with `token_hash`. On error it redirects to an error page without echoing the raw error into HTML.
- [ ] **Cookie and cache headers:**
  - Auth cookies are set only through `@supabase/ssr` (`HttpOnly` where the library allows, `Secure` and `SameSite=Lax` in production).
  - Authenticated pages and the callback are dynamic and not publicly cached (`Cache-Control: private, no-store` or Next dynamic rendering). No user data in a statically generated page.
- [ ] **No secrets in `NEXT_PUBLIC_*`:** only the URL and anon key. Check `next build` output and Vercel env vars.
- [ ] **The service-role key never reaches the client:** no `SUPABASE_SERVICE_ROLE_KEY` in any file imported by a client component, and none in `.env.example`.
- [ ] **Rate limiting of magic links:**
  - Supabase Auth rate limits for email sends and OTP are set, and custom SMTP is configured for production.
  - Consider CAPTCHA (hCaptcha or Turnstile) on sign-in.
  - The sign-in form shows the same message whether or not the email has an account.
- [ ] **Member-email visibility:** emails are shown only in the list's sharing view, to members. They are never put in URLs, page titles, logs or analytics.
- [ ] No `dangerouslySetInnerHTML` with list or todo titles. React escaping is enough for titles.
- [ ] Destructive actions (delete list, unshare) use POST or Server Actions, not GET links. Server Actions get Next's built-in origin check.

**Deploy (`docs/DEPLOY.md`)**

- [ ] The checklist includes SR-01 (confirm email, secure email change, password signups), SR-08 (anonymous sign-ins off), the redirect URL allowlist (exact production, preview and localhost callbacks, no broad wildcards beyond the team preview pattern), and the SR-02 live test.

## Not verified

- **Live RLS on a real Supabase project.** `verify.sql` passed only on a stubbed Postgres (`docs/DATABASE.md`). It was not run on `supabase start` or a hosted project in this review, because no live Supabase calls are allowed.
- **Realtime assumptions A1 and A2** (`contracts/realtime.md`). Both need a live Realtime server. See SR-02 and SR-04.
- **Supabase Auth dashboard settings** (confirm email, secure email change, anonymous sign-ins, rate limits, redirect URLs, SMTP). There is no access to the project.
- **CodeQL results.** The workflow was added in this task but has not run yet, so no CodeQL alerts have been triaged. Review the first run's alerts on the PR.
- **PR #6, the UI and the auth callback.** These are not on `main` yet and were not reviewed beyond a grep of the PR #6 diff.
- **Vercel configuration** (env vars, preview protection, domains). Not inspected.
