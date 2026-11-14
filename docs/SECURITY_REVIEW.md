# Security Review

Run `tododemosh-9023`, task T8 (security gate). Reviewed on 2026-11-14 (round 2).

## Scope and baseline

The baseline is `main` = `6571b27`. That includes the session middleware (PR #4), repo hygiene (PR #13), Dependabot config (PR #15), the realtime contract amendment (PR #7) and the data layer (PR #6). The deploy workflow (PR #14) is still open; it was reviewed at its current head `388687c`.

| Area | Files | Reviewed |
| --- | --- | --- |
| Schema, RLS, functions, grants | `supabase/migrations/20260101000000_init.sql`, `supabase/tests/verify.sql`, `docs/DATABASE.md` | yes |
| Contracts | `contracts/rls.md`, `contracts/realtime.md` (incl. the PR #7 amendment), `contracts/data-model.md`, `contracts/data-api.md` | yes |
| Supabase clients | `src/lib/supabase/{client,server,env}.ts`, `.env.example`, `.gitignore` | yes |
| Session middleware | `src/middleware.ts` (PR #4) | yes |
| Data layer | `src/lib/lists/{core,lists,todos,realtime,index}.ts`, `src/lib/sharing/{members,index}.ts` (PR #6) | yes |
| UI and `src/app/auth/callback` | not on `main` yet (UI PR #17) | **no** (see the re-review list) |
| Workflows on main | `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml` | yes |
| Deploy (PR #14, open) | `.github/workflows/deploy.yml`, `docs/DEPLOY.md`, `vercel.json` at `388687c` | yes; see the "Deploy workflow" section |
| Dependencies | `package.json`, `package-lock.json` (`npm audit --omit=dev`) | yes |
| Repo settings | read-only `gh api` calls | yes |

**Result: 0 critical, 0 high, 5 medium, 11 low, 13 info.** No high or critical finding is open.

- Open mediums: SR-01 and SR-02, both waiting on config checks or live tests.
- In-progress mediums: SR-23 and SR-24, both in PR #14 and being fixed by the release-engineer.

## Findings

Severity: critical / high / medium / low / info.

Status:
- `open`: action needed.
- `in progress`: an owner is fixing it now.
- `fixed`: verified fixed, with where and when.
- `accepted`: known, by design, or not reachable.
- `ok`: reviewed, no issue.

| ID | Severity | Location | Owner | Status |
| --- | --- | --- | --- | --- |
| SR-01 | medium | Supabase Auth settings; `public.list_role`, `public.my_member_id` | db (T4), release-engineer (T9) | open |
| SR-02 | medium | Realtime assumption A2, `contracts/realtime.md` | db (T4), data (T5) | open |
| SR-03 | low | Repo setting: private vulnerability reporting | orchestrator (repo admin) | fixed |
| SR-04 | low | Realtime assumption A1 (DELETE events) | contracts (T1), data (T5) | accepted |
| SR-05 | low | `list_members_select` policy | contracts (T1), ui | accepted |
| SR-06 | low | `postcss@8.4.31` pinned by `next@15.5.29` | orchestrator (future Next 16 upgrade task), scaffold (T2) | accepted |
| SR-07 | low | Security headers (`next.config.mjs`, `vercel.json` in PR #14) | release-engineer (T9), ui | in progress |
| SR-08 | low | No row quotas; anonymous sign-ins | db (T4), release-engineer (T9) | open |
| SR-09 | low | Repo setting: Dependabot security updates | orchestrator (repo owner) | open |
| SR-10 | info | Workflows pin actions by tag, not SHA | ci (T3), security-gate (T8) | accepted |
| SR-11 | info | Client-chosen primary keys on INSERT | db (T4) | accepted |
| SR-12 | info | `public.reorder_todos` takes no lock | db (T4) | accepted |
| SR-13 | info | Realtime channels are public channels | data (T5) | accepted |
| SR-14 | info | Migration: RLS, DEFINER functions, grants, email lookup, timestamps | db (T4) | ok |
| SR-15 | info | `src/lib/supabase/*`, env, secrets | scaffold (T2) | ok |
| SR-16 | info | `src/middleware.ts` | session (T12) | ok |
| SR-17 | info | `.github/workflows/ci.yml`, `codeql.yml` | ci (T3), security-gate (T8) | ok |
| SR-18 | info | Data layer `src/lib/lists`, `src/lib/sharing` | data (T5) | ok |
| SR-19 | info | `mapPg`, `guard`, `requireUser` in `src/lib/lists/core.ts`; `toAppError` in `realtime.ts` | data (T5), ui | open |
| SR-20 | info | Every future migration: function EXECUTE grants | db (T4) | open |
| SR-21 | info | CodeQL coverage of `src/` | security-gate (T8) | open |
| SR-22 | info | `deploy.yml` `workflow_run` guard | release-engineer (T9) | ok |
| SR-23 | medium | `deploy.yml` `workflow_dispatch` | release-engineer (T9) | in progress |
| SR-24 | medium | `deploy.yml` job-level `VERCEL_TOKEN` | release-engineer (T9) | in progress |
| SR-25 | low | `deploy.yml` secret interpolated into `run:` | release-engineer (T9) | fixed |
| SR-26 | medium | Vercel secrets: repository vs environment secrets | release-engineer (T9), orchestrator (repo admin) | fixed |
| SR-27 | low | `deploy.yml` smoke-test fallback URL | release-engineer (T9) | fixed |
| SR-28 | low | Smoke test against the unique deployment URL vs Vercel Deployment Protection | release-engineer (T9) | open |
| SR-29 | low | `deploy.yml` `VERCEL_CLI: vercel@65.16.0` | release-engineer (T9) | in progress |

### SR-01 (medium) Sharing depends on Supabase email confirmation being on

- **Location:** Supabase Dashboard > Authentication; `list_role` and `my_member_id` in the migration.
- **Description:** A member row grants access to whoever has a *confirmed* `auth.users.email` equal to `list_members.email`. The SQL does this correctly. But if "Confirm email" is off (`mailer_autoconfirm`), Supabase sets `email_confirmed_at` at signup and applies email changes without confirmation. An attacker could then sign up with a password, or change their email, to a victim's address and inherit every list shared with the victim. That includes shares created before the victim has an account. The safeguard is a dashboard setting that the repo cannot enforce.
- **Recommendation:** Keep "Confirm email" **on** and "Secure email change" **on**. Prefer magic link only: if password signups are not needed, disable them. Make these hard items in `docs/DEPLOY.md` and check them before go-live. PR #14 lists "Confirm email on" but not secure email change or password signups.
- **Status:** open. The setting on the live project was not checked.

### SR-02 (medium) Realtime A2 is unverified: INSERT and UPDATE events reaching only members

- **Location:** `contracts/realtime.md` assumption A2; `public.list_role` (SECURITY DEFINER) used by every SELECT policy; `src/lib/lists/realtime.ts` (its header notes A1/A2 are not verified there and hands them to the qa task).
- **Description:** Realtime applies the SELECT policies to each subscriber's INSERT and UPDATE events. That is safe only if `auth.uid()` inside the DEFINER function sees the subscriber's JWT claims. It should, because SECURITY DEFINER switches the role but not the `request.jwt.claims` setting. This has not been tested against a live Realtime server. If A2 is false, todo titles and member emails would reach non-members, and this finding becomes **high**.
- **Recommendation:** Before production, run the "data" verification in `contracts/realtime.md` (A, B as editor, C as non-member, plus a viewer and an unconfirmed-email user) on a local or dev Supabase. Record the result in `docs/DATABASE.md`.
- **Status:** open (verification pending).

### SR-03 (low) Private vulnerability reporting was disabled

- **Location:** repository settings.
- **Description:** `SECURITY.md` sends reporters to GitHub private vulnerability reporting. In round 1 it was off (`{"enabled":false}`), so the "Report a vulnerability" button was missing. The reviewer downgraded this from medium to low.
- **Recommendation:** Keep it enabled. `SECURITY.md` keeps a short fallback: a detail-free public issue, after which the maintainer opens a draft advisory and adds the reporter as a collaborator.
- **Status:** fixed by the orchestrator on 2026-11-14. Re-checked read-only: `gh api repos/TheCoder30ec4/TODODEMO-Skill-Test/private-vulnerability-reporting` returns `{"enabled":true}`.

### SR-04 (low) Realtime DELETE events leak row ids and timing across lists (A1)

- **Location:** `contracts/realtime.md` rows 2, 5 and 8, assumption A1; `src/lib/lists/realtime.ts` (DELETE subscriptions have no filter).
- **Description:** If A1 holds, every subscriber receives `{ id }` for every DELETE on `lists`, `todos` and `list_members` across all lists. The ids are random uuids and carry no titles or emails. A subscriber still learns the volume and timing of deletes app-wide.
- **Recommendation:** Accept for this app. If it matters later, move deletes to private channels with Realtime Authorization, for example a trigger that broadcasts to a per-list topic. Keep replica identity at default, so `old` stays `{ id }`. Confirm A1 in the same live test as SR-02.
- **Status:** accepted (documented in `contracts/realtime.md` and the README). A1 itself is unverified.

### SR-05 (low) Collaborators see each other's emails

- **Location:** `list_members_select` policy (`using (public.list_role(list_id) is not null)`), `listMembers` in `src/lib/sharing/members.ts`.
- **Description:** Viewers and editors can read every member email on lists they belong to, through queries and Realtime. Non-members see none.
- **Recommendation:** Keep it as designed (`contracts/rls.md`). The UI should show emails only inside the list's sharing view, never in URLs, logs or analytics.
- **Status:** accepted (by design).

### SR-06 (low) `npm audit --omit=dev`: vulnerable PostCSS pinned by Next

- **Location:** `node_modules/postcss@8.4.31`, an exact dependency of `next@15.5.29`.
- **Description:** `npm audit --omit=dev` reports 1 high (`postcss`) and 1 moderate (`next`, through postcss):
  - GHSA-qx2v-qp2m-jg93: XSS through an unescaped `</style>` in stringify output (`<8.5.10`).
  - GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849: arbitrary `.map` file read through an attacker-controlled `sourceMappingURL` (`<=8.5.22`).

  **Not reachable:** Next runs PostCSS only at build time, on the repo's own CSS (`src/app/globals.css`). The app never parses or stringifies user-supplied CSS. `@supabase/ssr` and `@supabase/supabase-js` have no advisories. The dev-only `postcss@8.5.32` under vite is outside the affected ranges.

  **No automatic fix path:**
  - `next@15.5.29` is the latest 15.x and still pins `postcss@8.4.31`. The only fix `npm audit` offers is `next@16.4.6` (semver major).
  - Dependabot PR #11 (Next 16) was closed.
  - `.github/dependabot.yml` (PR #15) now ignores semver-major npm updates, so no bot PR will bring it back.
- **Recommendation:** Track a **deliberate manual Next 16 upgrade as a future task**, owned by the orchestrator, carried out by scaffold (T2) or whoever owns `package.json`. Do it safely:
  1. Do it on its own branch, as one PR that changes only `next`, `eslint-config-next` and the lockfile (plus code needed for breaking changes).
  2. Read the Next 16 upgrade guide and run the official codemod (`npx @next/codemod@latest upgrade`). In particular, check that `middleware.ts` still works with the same matcher and cookie handling: Next 16 renames middleware to `proxy`.
  3. Install with `npm ci` from the updated lockfile. Then run `lint`, `typecheck`, `build` and `test` (the `ci` job), and `npm audit --omit=dev`, which should show no postcss advisory.
  4. Check auth by hand on a preview deployment: magic-link sign-in, session refresh through the middleware, and the `Cache-Control` and `Set-Cookie` headers on refreshed responses.
  5. Send it through the normal `orch/review` gate and the `codeql` check. Do not force an `overrides` entry against Next's exact postcss pin in the meantime.
- **Status:** accepted (not reachable). It stays at low until the Next 16 upgrade task closes it; re-run the audit then.

### SR-07 (low) Missing HTTP security headers

- **Location:** `next.config.mjs` on main (empty config); `vercel.json` in PR #14.
- **Description:** On main there is no `Content-Security-Policy`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options` or `Permissions-Policy`. That allows clickjacking of the share and delete actions, and gives no defence in depth against XSS. PR #14's `vercel.json` adds `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY` for every path. A CSP is still missing. Vercel adds HSTS on its domains.
- **Recommendation:** Merge the PR #14 headers. Then add a CSP (at least `frame-ancestors 'none'`; ideally `default-src 'self'` and `connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co`), tested against Next's inline scripts.
- **Status:** in progress (three headers in PR #14). CSP is open for ui.

### SR-08 (low) No quotas; anonymous sign-ins would count as `authenticated`

- **Location:** INSERT policies on all three tables; Supabase Auth settings.
- **Description:** Any signed-in user can create unlimited lists, todos and member rows. If Supabase anonymous sign-ins were enabled, anonymous users would get the `authenticated` role and could create lists. They would not get shared access, because they have no confirmed email.
- **Recommendation:** Keep anonymous sign-ins **off** and add that to `docs/DEPLOY.md` (not there at PR #14 `388687c`). Optionally cap rows per owner with a trigger if abuse appears.
- **Status:** open (config and docs item).

### SR-09 (low) Dependabot security updates are disabled

- **Location:** repository settings (`security_and_analysis.dependabot_security_updates: disabled`).
- **Description:** Dependabot alerts are enabled (`GET .../vulnerability-alerts` returns 204), but no automatic security-fix PRs are opened. Version updates run weekly through `.github/dependabot.yml`: npm minor and patch are grouped, npm majors ignored. So a security fix that needs a major bump (like SR-06) never arrives as a bot PR.
- **Recommendation:** Enable automated security fixes when convenient (`gh api -X PUT repos/TheCoder30ec4/TODODEMO-Skill-Test/automated-security-fixes`). Until then, triage Dependabot alerts by hand.
- **Status:** open. The repo owner chose not to enable it for now.

### SR-10 (info) Actions pinned by tag, not commit SHA

- **Location:** `ci.yml` (`actions/checkout@v7.0.1`, `actions/setup-node@v7.1.0`), `codeql.yml` (`actions/checkout@v7.0.1`, `github/codeql-action/*@v4.39.3`), and the same checkout/setup tags in PR #14's `deploy.yml`.
- **Description:** A moved or compromised tag would run new code. In `ci` and `codeql` each job has read-only `contents` and no secrets, which limits the impact. `deploy` holds the Vercel token, so the impact there is larger. All tags were verified to exist with `gh api repos/<owner>/<repo>/git/matching-refs/tags/<tag>`.
- **Recommendation:** Optionally pin to full SHAs with a `# vX.Y.Z` comment, starting with `deploy.yml`. Dependabot (`github-actions` ecosystem) keeps either form updated.
- **Status:** accepted (matches the repo convention).

### SR-11 (info) Clients can choose primary keys on INSERT

- **Location:** `grant select, insert, delete on public.lists, public.todos, public.list_members to authenticated` (table-level INSERT includes `id`).
- **Description:** A client can insert with an explicit `id`. A `23505` error then tells it that a guessed uuid already exists. Guessing a random v4 uuid is infeasible, and the ids exposed by A1 belong to deleted rows. The data layer never sends `id` on insert.
- **Recommendation:** None needed. Column-level INSERT grants that exclude `id` would close it if wanted.
- **Status:** accepted.

### SR-12 (info) `reorder_todos` takes no lock

- **Location:** `public.reorder_todos`.
- **Description:** A todo inserted between the set check and the UPDATE keeps its own position, which can create a tie. This is a correctness edge only: render order breaks ties by `createdAt`, then `id`, and authorization still goes through RLS (SECURITY INVOKER) plus the `list_role` gate.
- **Recommendation:** None for security. Add `select ... for update` on the list's todos if ties become a UX problem.
- **Status:** accepted.

### SR-13 (info) Realtime channels are public

- **Location:** `src/lib/lists/realtime.ts`. The channel is `list:{listId}:{n}`, with `n` a per-subscription counter (PR #7 amendment).
- **Description:** `postgres_changes` is filtered by RLS (subject to A2). But anyone with the anon key can join a public channel by name and send or receive **broadcast** and **presence** messages on it.
- **Recommendation:** Do not use broadcast or presence on these channels unless they become private channels with Realtime Authorization policies.
- **Status:** accepted (only `postgres_changes` is used).

### SR-14 (info) Migration review: no issues found

- **Location:** `supabase/migrations/20260101000000_init.sql`. `verify.sql` covers most of the points below, and those checks passed on a stubbed Postgres.
- **Description:**
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
- **Recommendation:** Run `verify.sql` on real Supabase (see "Not verified"). For future migrations, see SR-20.
- **Status:** ok.

### SR-15 (info) Supabase clients and secrets: no issues found

- **Location:** `src/lib/supabase/{client,server,env}.ts`, `.env.example`, `.gitignore`, git history.
- **Description:**
  - Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist. Both are meant to be public.
  - No service-role key, `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_*` or `auth.admin` appears in `src/` or the git history. Checked with `git log --all -p` and a grep of `src/`; the only history matches were lockfile integrity hashes.
  - `.env` and `.env.*` are gitignored. Repo secret scanning and push protection are enabled.
  - `env.ts` throws at production runtime when env vars are missing, and uses inert placeholders only during build, dev and test.
- **Recommendation:** None.
- **Status:** ok.

### SR-16 (info) Session middleware (PR #4): no issues found

- **Location:** `src/middleware.ts`.
- **Description:**
  - It calls `supabase.auth.getUser()`, which validates the token with the Auth server, rather than `getSession()`.
  - It copies `@supabase/ssr`'s cache headers onto refreshed responses, so a `Set-Cookie` response stays out of shared caches. It does not redirect, so there is no open redirect.
  - It is not used for authorization; RLS is. That also makes the class of CVE-2025-29927 middleware bypass irrelevant, and Next 15.5.29 is patched for it anyway.
  - Cost: one Auth round trip per matched request.
- **Recommendation:** Re-check it together with the auth callback, and during the Next 16 upgrade (SR-06).
- **Status:** ok.

### SR-17 (info) Workflows on main: no issues found

- **Location:** `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`.
- **Description:**
  - Workflow `permissions: contents: read`. Only the `codeql` job adds `security-events: write` and `actions: read`.
  - Both use `persist-credentials: false`, set timeouts, use no secrets, and there is no `pull_request_target` anywhere.
  - `codeql.yml` concurrency: a new push to a PR cancels that PR's running scan. On `main` (push and schedule share the `refs/heads/main` group), a running scan is never cancelled. GitHub keeps only one pending run per group, though, so an older queued run is cancelled in favour of the newest, which scans the latest `main`.
  - Code scanning default setup is `not-configured`, so this advanced workflow does not conflict with it.
  - `build-mode` is not set: the input is accepted only with one language per job (a matrix), which would rename the check to `codeql (<lang>)`. Both languages are interpreted, so CodeQL uses build mode `none` anyway.
- **Recommendation:** None.
- **Status:** ok.

### SR-18 (info) Data layer (PR #6): no access-control issues found

- **Location:** `src/lib/lists/{core,lists,todos,realtime}.ts`, `src/lib/sharing/members.ts`.
- **Description:**
  - **No account oracle in `shareList`.** It never queries `auth.users`. The insert succeeds the same way whether or not the email has an account (there is no FK on email). `Conflict` comes only from "already a member of this list" (`23505`) or "the owner's own email".
  - **Non-members get `NotFound`, never `Forbidden`.** The `gate` step 2 returns `NotFound` when the row is not visible or `my_role` is NULL. `runGated` re-checks access after 0 rows or `42501`.
  - **Ids are checked as uuids** (`isUuid` in `gate`, `listIdOfTodo`, `reorderTodos` and `subscribeToList`) before any query.
  - **Inputs are validated first:** titles (code-point length), emails (trimmed, lowercased, regex), role and `done`.
  - **PostgREST filters use only `.eq()`.** There are no `.or()`, `.filter()`, `.match()` or `.in()` calls and no string-built filters. The Realtime filters interpolate only a uuid-checked `listId`.
  - **"Who am I" uses `getUser()`**, not `getSession()`.
  - **Realtime:** handlers receive mapped camelCase rows. Own role and member id come from the server (`my_role`, `my_member_id`); emails are never compared client-side. Nothing fires after unsubscribe.
  - **Role checks in the client are UX only;** RLS enforces every write.
- **Recommendation:** None for the data layer itself. The UI must call `db.removeAllChannels()` before `signOut()` (contract item; it lives in the UI).
- **Status:** ok.

### SR-19 (info) Raw database and auth error messages pass through to callers

- **Location:** `src/lib/lists/core.ts`:
  - `mapPg` returns `message: msg` (the raw Postgres/PostgREST `message`) plus `cause` for `Unknown`.
  - `guard` returns `cause.message` of any thrown error.
  - `requireUser` returns `error.message` from Supabase Auth.

  `src/lib/lists/realtime.ts` `toAppError` does the same.
- **Description:** `Unknown` errors carry raw database or auth text and the original error object. That text can include constraint, column, table or function names, SQL fragments, network details or upstream auth messages. It is fine for logs, but shown verbatim it leaks internals and makes probing easier.
- **Recommendation:**
  - **ui:** never render `error.message` for `kind: "Unknown"` (or `cause` for any kind). Show a generic message per `kind`, and log the details server-side or to the console in dev only. Never serialize `cause` across the server-to-client boundary, for example from a Server Action return value.
  - **data, optional:** keep `cause` but set `message: "Unexpected error"` for `Unknown`.
- **Status:** open (data and ui).

### SR-20 (info) Future migrations must repeat the function EXECUTE revoke/grant block

- **Location:** `supabase/migrations/*` (every future migration).
- **Description:** Supabase's default privileges grant EXECUTE on every new function in `public` to `anon`, `authenticated` and `service_role`, and grant table privileges on new tables. The init migration revokes these explicitly. A later migration that adds or replaces a function or table without that revoke/grant block would quietly expose it to `anon`. For a SECURITY DEFINER function, that bypasses RLS.
- **Recommendation:**
  - Every migration that creates a function or table repeats the pattern from the init migration: `revoke all ... from public, anon, authenticated;`, then explicit grants, plus `set search_path = ''` and an owner.
  - Extend `verify.sql`'s structural checks (for example "anon has no EXECUTE on any `public` function", "every DEFINER function has empty `search_path`") so CI on a real database would catch a miss.
- **Status:** open (process item for db).

### SR-21 (info) CodeQL has not yet scanned `src/` in full

- **Location:** `.github/workflows/codeql.yml`; Security > Code scanning.
- **Description:** The `codeql` check ran on PR #16 and passed with 0 alerts (run `43575424614`). PR analysis only reports alerts on lines the PR changes, though, and this PR touches no JS or TS. So the existing `src/` code (data layer, middleware, Supabase clients) has not had a full scan with results reviewed.
- **Recommendation:** After this workflow merges, check the first `push` analysis on `main` (and the weekly scheduled one) in Security > Code scanning. Triage any alerts, and record the result here.
- **Status:** open until the first analysis on `main` is reviewed.

## Deploy workflow (PR #14, open)

Reviewed at head `388687c`: `.github/workflows/deploy.yml`, `docs/DEPLOY.md` and `vercel.json`. The PR is still being revised by its author (release-engineer, T9), who is fixing the dispatch-any-branch, token scope and version pin items now. Findings marked `in progress` may already be fixed at merge; re-check them on the merged commit.

What is already right:
- Workflow-level `permissions: contents: read`.
- `persist-credentials: false`.
- The job is bound to `environment: production`, which has a `required_reviewers` rule (owner) and a deployment branch policy of `protected_branches: true`. Only `main` is protected.
- `concurrency: deploy-production` with `cancel-in-progress: false`.
- Checkout of `workflow_run.head_sha`, so the deploy builds exactly the commit CI validated.
- A preflight check for missing secrets.
- No `pull_request_target`.
- `docs/DEPLOY.md` forbids the service-role key.

### SR-22 (info) `workflow_run` guard is correct

- **Location:** `deploy.yml` `on.workflow_run` (`workflows: [ci]`, `types: [completed]`, `branches: [main]`) and the job `if`.
- **Description:** The guard requires `conclusion == 'success'`, `workflow_run.event == 'push'` and `head_repository.full_name == github.repository`. So a PR run, a fork run or a failed run on `main` never deploys.
- **Recommendation:** Keep it.
- **Status:** ok.

### SR-23 (medium) `workflow_dispatch` can deploy any branch to production after one approval

- **Location:** `deploy.yml` `on.workflow_dispatch` and the job `if` (`github.event_name == 'workflow_dispatch' || ...`), checkout `ref: ... || github.sha`.
- **Description:** A manual run checks out whatever ref was selected and deploys it with `--prod`. It skips CI, and the docs say so. One approval puts unreviewed, un-CI'd code into production. The environment's `protected_branches` policy should already reject non-`main` refs, because only `main` is protected. That is not verified, and it is a setting, not code.
- **Recommendation:**
  - Add `github.ref == 'refs/heads/main'` to the dispatch branch of the `if`.
  - Change the environment's branch policy to a custom policy allowing only `main`.
  - Optionally require a green `ci` run for the dispatched SHA.
- **Status:** in progress (release-engineer).

### SR-24 (medium) `VERCEL_TOKEN` is exposed to install scripts

- **Location:** `deploy.yml` job-level `env: VERCEL_TOKEN`; steps `npx --yes vercel@... pull/build/deploy --token="$VERCEL_TOKEN"`.
- **Description:** The token is in the environment of every step. That includes `npx --yes`, which installs the CLI and its dependency tree with lifecycle scripts, and `vercel build`, which installs the project's dependencies and runs their install scripts. Any compromised package in either tree can read and exfiltrate a token with deploy rights. Passing it as `--token=` also puts it on the command line, where other processes on the runner can see it.
- **Recommendation:**
  - Scope `VERCEL_TOKEN` to the `pull` and `deploy` steps only, and run `vercel build` without it.
  - Pass the token as the `VERCEL_TOKEN` env var instead of `--token`.
  - Install the CLI once with `--ignore-scripts` (or from a lockfile).
  - Use a token scoped to the Vercel team or project with an expiry.
- **Status:** in progress (release-engineer).

### SR-25 (low) Secret interpolated into `run:` lines

- **Location:** `deploy.yml` at `1634b53` (`--token="${{ secrets.VERCEL_TOKEN }}"` in three `run:` lines).
- **Description:** `${{ }}` in `run:` is substituted into the script text before the shell runs. That is the pattern behind script injection, and it bakes the secret into the generated script.
- **Recommendation:** Reference `$VERCEL_TOKEN` from `env`.
- **Status:** fixed at `388687c`. No `${{ secrets.* }}` appears in any `run:` line.

### SR-26 (medium) Repository secrets are not gated by environment approval

- **Location:** where the Vercel secrets are stored; `docs/DEPLOY.md`.
- **Description:** Repository secrets are available to any workflow run on a push, with no approval. Only environment secrets are withheld until the `production` reviewer approves.
- **Recommendation:** Store `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as **environment secrets** on `production` (`gh secret set NAME --env production`). Never as repository secrets.
- **Status:** fixed in `docs/DEPLOY.md` at `388687c`. Read-only check (secret names only): no repository secrets and no `production` environment secrets exist yet. Re-check when they are created.

### SR-27 (low) Smoke-test fallback pointed at a third-party site

- **Location:** `deploy.yml` smoke-test step (earlier revision).
- **Description:** A fallback URL outside the project made the smoke test "pass" against a site the project does not control. That gave a false signal and sent a request to a third party on every deploy.
- **Recommendation:** Test only the deployment URL and the optional `SMOKE_URL`.
- **Status:** fixed at `388687c` ("There is no fallback URL").

### SR-28 (low) Smoke test against the unique deployment URL vs Deployment Protection

- **Location:** `deploy.yml` `check "$DEPLOY_URL"`; `docs/DEPLOY.md` troubleshooting row "401/403".
- **Description:** Vercel Deployment Protection can answer 401 on the unique `*.vercel.app` deployment URL, so the job fails after a good deploy. The doc's suggested fix is to relax Deployment Protection for production, which weakens a security control to make a check pass.
- **Recommendation:** Smoke-test the production alias (`SMOKE_URL`, required rather than optional), or send Vercel's "Protection Bypass for Automation" secret as a header from an environment secret. Do not disable Deployment Protection.
- **Status:** open (release-engineer).

### SR-29 (low) Vercel CLI pinned to a release only hours old

- **Location:** `deploy.yml` `VERCEL_CLI: vercel@65.16.0`.
- **Description:** `npm view vercel time` shows `65.16.0` was published on 2026-11-14 at 00:05 UTC, hours before it was pinned, with snapshot builds after it. A brand-new release has had no time for a malicious or broken publish to be noticed. `npx --yes` also resolves the CLI's transitive dependencies fresh on every run, without a lockfile.
- **Recommendation:** Pin a release at least 7 to 14 days old. Prefer an install from a lockfile, or with `--ignore-scripts`, over `npx --yes` (this also helps SR-24).
- **Status:** in progress (release-engineer).

## Re-review when these merge

**UI and auth (UI PR #17: `src/app/auth/callback`, sign-in, list pages)**

- [ ] **Open redirect in `/auth/callback`:**
  - `next` or `redirectTo` must be a same-origin relative path. Reject `//host`, `/\host`, absolute URLs and `javascript:`.
  - Build the redirect from `request.nextUrl.origin` (or a fixed site URL), not from `x-forwarded-host` without an allowlist.
- [ ] The callback uses `exchangeCodeForSession` (PKCE) or `verifyOtp` with `token_hash`. On error it redirects to an error page without echoing the raw error into HTML.
- [ ] **CSRF on `route.ts` handlers:**
  - Route handlers do not get the Origin/Host check that Server Actions get.
  - Every state-changing `route.ts` (POST, PUT, PATCH, DELETE) must verify that `Origin` (or `Sec-Fetch-Site: same-origin`) matches the app's host, and must not accept simple-form content types without that check.
  - No GET handler changes state, except the auth callback, which only exchanges a one-time code.
- [ ] **Cookie and cache headers:**
  - Auth cookies are set only through `@supabase/ssr` (`Secure` and `SameSite=Lax` in production).
  - Authenticated pages and the callback are dynamic and not publicly cached (`Cache-Control: private, no-store` or Next dynamic rendering). No user data in a statically generated page.
- [ ] **No secrets in `NEXT_PUBLIC_*`:** only the URL and anon key. Check `next build` output and Vercel env vars.
- [ ] **The service-role key never reaches the client:** no `SUPABASE_SERVICE_ROLE_KEY` in any file imported by a client component, and none in `.env.example`.
- [ ] **Rate limiting of magic links:**
  - Supabase Auth rate limits for email sends and OTP are set, and custom SMTP is configured for production.
  - Consider CAPTCHA (hCaptcha or Turnstile) on sign-in.
  - The sign-in form shows the same message whether or not the email has an account.
- [ ] **Email enumeration via `shareList` in the UI:** the share form shows the same success state whether or not the invitee has an account. The data layer already behaves this way (SR-18).
- [ ] **Member-email visibility:** emails are shown only in the list's sharing view, to members. They are never put in URLs, page titles, logs or analytics.
- [ ] **Error display:** SR-19. `Unknown` messages and `cause` are never rendered or sent to the client.
- [ ] No `dangerouslySetInnerHTML` with list or todo titles. React escaping is enough for titles.
- [ ] `db.removeAllChannels()` runs before `auth.signOut()`.
- [ ] Destructive actions (delete list, unshare) use POST or Server Actions, not GET links.

**Deploy (PR #14, on merge)**

- [ ] Re-check SR-23, SR-24, SR-28 and SR-29 on the merged commit.
- [ ] `docs/DEPLOY.md` includes SR-01 (confirm email, secure email change, password signups), SR-08 (anonymous sign-ins off), exact redirect URLs, and the SR-02 live test.
- [ ] After secrets are created: they are environment secrets on `production`, and there are no repository secrets (SR-26).

## Not verified

- **Live RLS on a real Supabase project.** `verify.sql` passed only on a stubbed Postgres (`docs/DATABASE.md`). It was not run on `supabase start` or a hosted project in this review, because no live Supabase calls are allowed.
- **Realtime assumptions A1 and A2** (`contracts/realtime.md`). Both need a live Realtime server. See SR-02 and SR-04.
- **Supabase Auth dashboard settings** (confirm email, secure email change, anonymous sign-ins, rate limits, redirect URLs, SMTP). There is no access to the project.
- **CodeQL on `main`.** The PR #16 run (0 alerts) covered only lines changed by that PR, which has no JS or TS. A full analysis of `src/` exists only after the first `push` run on `main` or the weekly schedule. SR-21 stays open until that is reviewed.
- **Environment branch policy enforcement** for `workflow_dispatch` (SR-23). It was read from settings, not exercised.
- **The UI and the auth callback.** Not on `main` yet.
- **Vercel configuration** (env vars, Deployment Protection, domains, token scope). Not inspected; no Vercel access.
- **PR #14 after `388687c`.** Later revisions were not reviewed.
