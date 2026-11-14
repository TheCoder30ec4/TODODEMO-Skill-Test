# Security Review

Run `tododemosh-9023`, task T8 (security gate). Reviewed on 2026-11-14 (round 3, final).

## Scope and baseline

The baseline is `main` = `d73ea75`. It includes:

- the data layer (PR #6), realtime contract amendment (PR #7), session middleware (PR #4), repo hygiene (PR #13) and Dependabot config (PR #15)
- the UI and auth callback (PR #17, `59444e2`)
- the deploy workflow (PR #14, merged as `d73ea75` from head `05a6603`)

Everything below was reviewed on the merged code.

| Area | Files | Reviewed |
| --- | --- | --- |
| Schema, RLS, functions, grants | `supabase/migrations/20260101000000_init.sql`, `supabase/tests/verify.sql`, `docs/DATABASE.md` | yes |
| Contracts | `contracts/rls.md`, `contracts/realtime.md`, `contracts/data-model.md`, `contracts/data-api.md` | yes |
| Supabase clients | `src/lib/supabase/{client,server,env}.ts`, `.env.example`, `.gitignore` | yes |
| Session middleware | `src/middleware.ts` | yes |
| Data layer | `src/lib/lists/*`, `src/lib/sharing/*` | yes |
| UI and auth | `src/app/auth/callback/route.ts`, `src/app/login/page.tsx`, `src/app/page.tsx`, `src/app/lists/**`, `src/components/*` | yes |
| Workflows | `.github/workflows/ci.yml`, `codeql.yml`, `deploy.yml`, `.github/dependabot.yml` | yes |
| Deploy config | `vercel.json`, `docs/DEPLOY.md` | yes |
| Dependencies | `package.json`, `package-lock.json` (`npm audit --omit=dev`) | yes |
| Repo settings | read-only `gh api` calls | yes |

**Result: 0 critical, 0 high, 6 medium, 15 low, 17 info (38 findings).** No high or critical finding is open. SR-21 (info) records the one CodeQL alert on `main`, triaged as a false positive.

- Open mediums: SR-01 and SR-02. Both depend on Supabase configuration or a live Realtime test that this review could not run.
- The four deploy mediums (SR-23, SR-24, SR-26, SR-30) are fixed.

## Findings

Severity: critical / high / medium / low / info.

Status:
- `open`: action needed.
- `fixed`: verified fixed, with where.
- `accepted`: known, by design, or not reachable.
- `ok`: reviewed, no issue.

| ID | Severity | Location | Owner | Status |
| --- | --- | --- | --- | --- |
| SR-01 | medium | Supabase Auth settings; `public.list_role`, `public.my_member_id` | db (T4), release-engineer (T9) | open |
| SR-02 | medium | Realtime assumption A2, `contracts/realtime.md` | db (T4), data (T5) | open |
| SR-03 | low | Repo setting: private vulnerability reporting | orchestrator (repo admin) | fixed |
| SR-04 | low | Realtime assumption A1 (DELETE events) | contracts (T1), data (T5) | accepted |
| SR-05 | low | `list_members_select` policy; `ShareDialog.tsx` | contracts (T1), ui (T6) | accepted |
| SR-06 | low | `postcss@8.4.31` pinned by `next@15.5.29` | orchestrator (future Next 16 upgrade task), scaffold (T2) | accepted |
| SR-07 | low | Security headers: `vercel.json` (3 set), no CSP | ui (T6) | open |
| SR-08 | low | No row quotas; anonymous sign-ins | db (T4), release-engineer (T9) | open |
| SR-09 | low | Repo setting: Dependabot security updates | orchestrator (repo owner) | open |
| SR-10 | info | Workflows pin actions by tag, not SHA | ci (T3), release-engineer (T9), security-gate (T8) | accepted |
| SR-11 | info | Client-chosen primary keys on INSERT | db (T4) | accepted |
| SR-12 | info | `public.reorder_todos` takes no lock | db (T4) | accepted |
| SR-13 | info | Realtime channels are public channels | data (T5) | accepted |
| SR-14 | info | Migration: RLS, DEFINER functions, grants, email lookup, timestamps | db (T4) | ok |
| SR-15 | info | `src/lib/supabase/*`, env, secrets | scaffold (T2) | ok |
| SR-16 | info | `src/middleware.ts` | session (T12) | ok |
| SR-17 | info | `.github/workflows/ci.yml`, `codeql.yml` | ci (T3), security-gate (T8) | ok |
| SR-18 | info | Data layer `src/lib/lists`, `src/lib/sharing` | data (T5) | ok |
| SR-19 | low | Raw `Unknown` and Supabase Auth messages rendered in the UI | ui (T6), data (T5) | open |
| SR-20 | info | Every future migration: function EXECUTE grants | db (T4) | open |
| SR-21 | info | CodeQL first analysis on `main`: alert #1 `js/xss-through-dom` | security-gate (T8), main-guardian | triaged (false positive); hardening awaits PR CodeQL run |
| SR-22 | info | `deploy.yml` `workflow_run` guard | release-engineer (T9) | ok |
| SR-23 | medium | `deploy.yml` `workflow_dispatch` from any branch | release-engineer (T9) | fixed |
| SR-24 | medium | `deploy.yml` `VERCEL_TOKEN` exposure | release-engineer (T9) | fixed |
| SR-25 | low | `deploy.yml` secret interpolated into `run:` | release-engineer (T9) | fixed |
| SR-26 | medium | Vercel secrets: repository vs environment secrets | release-engineer (T9), orchestrator (repo admin) | fixed |
| SR-27 | low | `deploy.yml` smoke-test fallback URL | release-engineer (T9) | fixed |
| SR-28 | low | Smoke test vs Vercel Deployment Protection | release-engineer (T9) | fixed |
| SR-29 | low | `deploy.yml` Vercel CLI version age | release-engineer (T9) | fixed |
| SR-30 | medium | Vercel Git integration bypasses the approval gate | release-engineer (T9) | fixed |
| SR-31 | low | `vercel link --yes` / non-interactive shell auto-connects Git | release-engineer (follow-up T16) | open |
| SR-32 | low | `package.json` `engines.node >=22` makes Vercel use Node 26 | app-shell (follow-up T15) | open |
| SR-33 | info | Unapproved `deploy` runs wait in the Actions tab | release-engineer (T9), orchestrator (approver) | accepted |
| SR-34 | info | `src/app/auth/callback/route.ts` | ui (T6) | ok |
| SR-35 | info | CSRF surface (`route.ts`, writes) | ui (T6) | ok |
| SR-36 | info | Client bundle, cache headers, XSS sinks | ui (T6) | ok |
| SR-37 | info | `ListsDashboard.tsx` sign-out does not await `removeAllChannels()` | ui (T6) | open |
| SR-38 | low | Magic-link rate limiting and CAPTCHA | release-engineer (T9), db (T4) | open |

### SR-01 (medium) Sharing depends on Supabase email confirmation being on

- **Location:** Supabase Dashboard > Authentication; `list_role` and `my_member_id` in the migration.
- **Description:** A member row grants access to whoever has a *confirmed* `auth.users.email` equal to `list_members.email`. The SQL does this correctly. But if "Confirm email" is off (`mailer_autoconfirm`), Supabase sets `email_confirmed_at` at signup and applies email changes without confirmation. An attacker could then sign up with a password, or change their email, to a victim's address and inherit every list shared with the victim. That includes shares created before the victim has an account. The safeguard is a dashboard setting that the repo cannot enforce.
- **Recommendation:**
  - Keep "Confirm email" **on** and "Secure email change" **on**.
  - The app uses magic links only, so disable password signups.
  - `docs/DEPLOY.md` (merged) requires "Confirm email on". Add secure email change and the password-signup setting.
- **Status:** open. The setting on the live project was not checked.

### SR-02 (medium) Realtime A2 is unverified: INSERT and UPDATE events reaching only members

- **Location:** `contracts/realtime.md` assumption A2; `public.list_role` (SECURITY DEFINER) used by every SELECT policy; `src/lib/lists/realtime.ts`.
- **Description:** Realtime applies the SELECT policies to each subscriber's INSERT and UPDATE events. That is safe only if `auth.uid()` inside the DEFINER function sees the subscriber's JWT claims. It should, because SECURITY DEFINER switches the role but not the `request.jwt.claims` setting. This has not been tested against a live Realtime server. If A2 is false, todo titles and member emails would reach non-members, and this finding becomes **high**.
- **Recommendation:** Before real users, run the "data" verification in `contracts/realtime.md` (A, B as editor, C as non-member, plus a viewer and an unconfirmed-email user) on a local or dev Supabase. Record the result in `docs/DATABASE.md`.
- **Status:** open (verification pending).

### SR-03 (low) Private vulnerability reporting was disabled

- **Location:** repository settings.
- **Description:** `SECURITY.md` sends reporters to GitHub private vulnerability reporting. In round 1 it was off (`{"enabled":false}`), so the "Report a vulnerability" button was missing. The reviewer downgraded this from medium to low.
- **Recommendation:** Keep it enabled. `SECURITY.md` keeps a short fallback: a detail-free public issue, after which the maintainer opens a draft advisory and adds the reporter as a collaborator.
- **Status:** fixed by the orchestrator on 2026-11-14. `gh api repos/TheCoder30ec4/TODODEMO-Skill-Test/private-vulnerability-reporting` returns `{"enabled":true}`.

### SR-04 (low) Realtime DELETE events leak row ids and timing across lists (A1)

- **Location:** `contracts/realtime.md` rows 2, 5 and 8, assumption A1; `src/lib/lists/realtime.ts` (DELETE subscriptions have no filter).
- **Description:** If A1 holds, every subscriber receives `{ id }` for every DELETE on `lists`, `todos` and `list_members` across all lists. The ids are random uuids and carry no titles or emails. A subscriber still learns the volume and timing of deletes app-wide.
- **Recommendation:** Accept for this app. If it matters later, move deletes to private channels with Realtime Authorization. Keep replica identity at default, so `old` stays `{ id }`. Confirm A1 in the same live test as SR-02.
- **Status:** accepted (documented in `contracts/realtime.md` and the README). A1 itself is unverified.

### SR-05 (low) Collaborators see each other's emails

- **Location:** `list_members_select` policy; `listMembers`; `src/components/ShareDialog.tsx` (member list, L74-82).
- **Description:** Viewers and editors can read every member email on lists they belong to. In the UI, emails appear only in the share dialog (text and `aria-label`s), never in URLs, page titles, query strings or storage. That was checked by grep over `src/components` and `src/app`. Non-members see none.
- **Recommendation:** Keep it as designed (`contracts/rls.md`).
- **Status:** accepted (by design).

### SR-06 (low) `npm audit --omit=dev`: vulnerable PostCSS pinned by Next

- **Location:** `node_modules/postcss@8.4.31`, an exact dependency of `next@15.5.29`.
- **Description:** `npm audit --omit=dev` reports 1 high (`postcss`) and 1 moderate (`next`, through postcss):
  - GHSA-qx2v-qp2m-jg93: XSS through an unescaped `</style>` in stringify output (`<8.5.10`).
  - GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849: arbitrary `.map` file read through an attacker-controlled `sourceMappingURL` (`<=8.5.22`).

  **Not reachable:** Next runs PostCSS only at build time, on the repo's own CSS. The app never parses or stringifies user-supplied CSS. `@supabase/ssr` and `@supabase/supabase-js` have no advisories.

  **No automatic fix path:**
  - `next@15.5.29` is the latest 15.x and still pins `postcss@8.4.31`.
  - Dependabot PR #11 (Next 16) was closed.
  - `.github/dependabot.yml` (PR #15) ignores semver-major npm updates, so no bot PR will bring it back.
- **Recommendation:** Track a **deliberate manual Next 16 upgrade as a future task**, owned by the orchestrator and carried out by scaffold (T2) or whoever owns `package.json`:
  1. Do it on its own branch, as one PR that changes only `next`, `eslint-config-next`, the lockfile, and code needed for breaking changes.
  2. Read the Next 16 upgrade guide and run `npx @next/codemod@latest upgrade`. Check that `middleware.ts` (renamed to `proxy` in Next 16) keeps the same matcher and cookie handling, and that `/auth/callback` still redirects correctly.
  3. Run `npm ci`, then `lint`, `typecheck`, `build`, `test` and `npm audit --omit=dev`, which should show no postcss advisory.
  4. On a non-production deployment, check by hand: magic-link sign-in, session refresh, and the `Cache-Control` and `Set-Cookie` headers on refreshed responses.
  5. Send it through `orch/review` and the `codeql` check. Do not force an `overrides` entry against Next's exact pin in the meantime.
- **Status:** accepted (not reachable). It stays at low until the upgrade task closes it.

### SR-07 (low) No Content-Security-Policy

- **Location:** `vercel.json` (merged), `next.config.mjs`.
- **Description:** `vercel.json` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY` on every path, which closes clickjacking. Vercel adds HSTS. There is still no `Content-Security-Policy` as defence in depth against XSS.
- **Recommendation:** Add a CSP, tested against Next's inline scripts: `default-src 'self'`, plus `connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co`, plus `frame-ancestors 'none'`.
- **Status:** open (CSP only; the other headers are fixed on main).

### SR-08 (low) No quotas; anonymous sign-ins would count as `authenticated`

- **Location:** INSERT policies on all three tables; Supabase Auth settings; `docs/DEPLOY.md`.
- **Description:** Any signed-in user can create unlimited lists, todos and member rows. If Supabase anonymous sign-ins were enabled, anonymous users would get the `authenticated` role and could create lists. They would not get shared access, because they have no confirmed email. The merged `docs/DEPLOY.md` does not mention anonymous sign-ins.
- **Recommendation:** Keep anonymous sign-ins **off** and add that to `docs/DEPLOY.md`. Optionally cap rows per owner with a trigger if abuse appears.
- **Status:** open (config and docs item).

### SR-09 (low) Dependabot security updates are disabled

- **Location:** repository settings (`security_and_analysis.dependabot_security_updates: disabled`).
- **Description:** Dependabot alerts are enabled (`GET .../vulnerability-alerts` returns 204), but no automatic security-fix PRs are opened. Version updates run weekly; npm majors are ignored. So a security fix that needs a major bump (like SR-06) never arrives as a bot PR.
- **Recommendation:** Enable automated security fixes when convenient (`gh api -X PUT repos/TheCoder30ec4/TODODEMO-Skill-Test/automated-security-fixes`). Until then, triage Dependabot alerts by hand.
- **Status:** open. The repo owner chose not to enable it for now.

### SR-10 (info) Actions pinned by tag, not commit SHA

- **Location:** `ci.yml`, `codeql.yml` and `deploy.yml` (`actions/checkout@v7.0.1`, `actions/setup-node@v7.1.0`, `github/codeql-action/*@v4.39.3`).
- **Description:** A moved or compromised tag would run new code. `ci` and `codeql` have read-only `contents` and no secrets. `deploy` runs after approval with the Vercel token present in some steps (SR-24), so the impact there is larger. All tags were verified to exist with `gh api repos/<owner>/<repo>/git/matching-refs/tags/<tag>`.
- **Recommendation:** Optionally pin to full SHAs with a `# vX.Y.Z` comment, starting with `deploy.yml`. Dependabot (`github-actions`) keeps either form updated.
- **Status:** accepted (matches the repo convention).

### SR-11 (info) Clients can choose primary keys on INSERT

- **Location:** `grant select, insert, delete on public.lists, public.todos, public.list_members to authenticated`.
- **Description:** A client can insert with an explicit `id`. A `23505` error then tells it that a guessed uuid already exists. Guessing a random v4 uuid is infeasible, and the data layer never sends `id` on insert.
- **Recommendation:** None needed. Column-level INSERT grants that exclude `id` would close it.
- **Status:** accepted.

### SR-12 (info) `reorder_todos` takes no lock

- **Location:** `public.reorder_todos`.
- **Description:** A todo inserted between the set check and the UPDATE keeps its own position, which can create a tie. This is a correctness edge only: render order breaks ties by `createdAt`, then `id`, and authorization still goes through RLS plus the `list_role` gate.
- **Recommendation:** None for security. Lock the list's todos if ties become a UX problem.
- **Status:** accepted.

### SR-13 (info) Realtime channels are public

- **Location:** `src/lib/lists/realtime.ts` (channel `list:{listId}:{n}`).
- **Description:** `postgres_changes` is filtered by RLS (subject to A2). But anyone with the anon key can join a public channel by name and send or receive **broadcast** and **presence** messages on it.
- **Recommendation:** Do not use broadcast or presence on these channels unless they become private channels with Realtime Authorization.
- **Status:** accepted (only `postgres_changes` is used).

### SR-14 (info) Migration review: no issues found

- **Location:** `supabase/migrations/20260101000000_init.sql`. `verify.sql` covers most of the points below on a stubbed Postgres.
- **Description:**
  - **RLS** is enabled on all three tables, and every policy is `TO authenticated`. FORCE RLS is off on purpose, so the DEFINER helpers owned by `postgres` bypass RLS without recursion.
  - **SECURITY DEFINER functions:**
    - `list_role` and `my_member_id` set `search_path = ''`, qualify every name, are owned by `postgres`, and have EXECUTE revoked from `public` and `anon`.
    - They return data only about the caller. `list_role` gives NULL for a missing list and for a non-member alike, so it is not an existence oracle.
    - Owner wins.
  - **Confirmed-email lookup:** `lower(u.email)` comes from `auth.users` with `email_confirmed_at is not null`. The JWT email claim is never used.
  - **Grants:** revoke-all first, then `SELECT/INSERT/DELETE` plus column-level UPDATE: `lists.title`; `todos.title, done, position`; `list_members.role`. INSERT policies pin `owner_id`, `created_by` and `added_by` to `auth.uid()`.
  - **Timestamps:** triggers force `created_at` and `updated_at` to server time.
  - **`reorder_todos`:** INVOKER, checks the role first, compares the exact id set, and raises `P0001`.
- **Recommendation:** Run `verify.sql` on real Supabase (see "Not verified"). For future migrations, see SR-20.
- **Status:** ok.

### SR-15 (info) Supabase clients and secrets: no issues found

- **Location:** `src/lib/supabase/{client,server,env}.ts`, `.env.example`, `.gitignore`, git history.
- **Description:**
  - Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist.
  - No service-role key, `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_*` or `auth.admin` appears in `src/` or the git history (`git log --all -p` and a grep of `src/`).
  - `.env*` files are gitignored, and secret scanning and push protection are enabled.
  - `env.ts` throws at production runtime when env vars are missing.
- **Recommendation:** None.
- **Status:** ok.

### SR-16 (info) Session middleware: no issues found

- **Location:** `src/middleware.ts`.
- **Description:** It uses `getUser()`, not `getSession()`. It copies `@supabase/ssr`'s cache headers onto refreshed responses and has no redirects. It is not used for authorization (RLS is), so the CVE-2025-29927 class of middleware bypass is irrelevant; Next 15.5.29 is patched for it anyway.
- **Recommendation:** Re-check during the Next 16 upgrade (SR-06).
- **Status:** ok.

### SR-17 (info) `ci.yml` and `codeql.yml`: no issues found

- **Location:** `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`.
- **Description:**
  - Workflow `permissions: contents: read`. Only the `codeql` job adds `security-events: write` and `actions: read`.
  - Both use `persist-credentials: false`, set timeouts, use no secrets, and there is no `pull_request_target` anywhere.
  - `codeql.yml` concurrency: a new push to a PR cancels that PR's running scan. On `main` (push and schedule share a group), a running scan is never cancelled, but an older queued run is replaced by the newest one.
  - `build-mode` is left implicit. The input needs one language per job (a matrix), which would rename the check to `codeql (<lang>)`, and both languages default to `none` anyway.
- **Recommendation:** None.
- **Status:** ok.

### SR-18 (info) Data layer: no access-control issues found

- **Location:** `src/lib/lists/{core,lists,todos,realtime}.ts`, `src/lib/sharing/members.ts`.
- **Description:**
  - `shareList` never queries `auth.users`, and its insert behaves the same whether or not the email has an account. `Conflict` comes only from an existing member (`23505`) or the owner's own email.
  - Non-members get `NotFound`, never `Forbidden`.
  - Ids are checked as uuids before any query.
  - Inputs are validated first.
  - PostgREST filters use only `.eq()`, and Realtime filters interpolate only a uuid-checked `listId`.
  - "Who am I" uses `getUser()`.
  - Client-side role checks are UX only; RLS enforces every write.
- **Recommendation:** None.
- **Status:** ok.

### SR-19 (low) Raw `Unknown` and Supabase Auth messages are rendered verbatim

- **Location:**
  - Pass-through in the data layer:
    - `src/lib/lists/core.ts`: `mapPg` (`message: msg` for `Unknown`), `guard` (`cause.message`) and `requireUser` (Auth `error.message`)
    - `realtime.ts`: `toAppError`
  - Rendered in the UI:
    - `src/components/ListView.tsx`: L49 `setError(d.error.message)`, and L78 `fail()` falls back to `e.message` for every kind except `Forbidden`
    - `src/components/ListsDashboard.tsx`: L27, L38, L47 `setError(r.error.message)`
    - `src/components/ShareDialog.tsx`: L22 `explain()` returns `e.message` for every kind except `InvalidEmail` and `Conflict`
    - `src/app/login/page.tsx`: L23, the Supabase Auth `error.message` from `signInWithOtp`, and L25, the raw exception message
- **Description:** Postgres/PostgREST and Auth error text reaches the screen unchanged. It can include constraint, table, column or function names, network errors or upstream Auth wording. Two things limit the impact: the user's own browser already receives these responses, and React escapes the text, so there is no XSS. The real risks:
  - It makes probing easier.
  - On the login page, Auth messages can vary by account state, for example "Signups not allowed for otp" if signups are ever disabled. That becomes an email-enumeration signal.
- **Recommendation:**
  - **ui:** map every `kind` to a fixed message, and show a generic "Something went wrong, try again" for `Unknown`. On the login page, always show the same "Check your email" result. The one exception is a fixed rate-limit message, chosen by `error.status === 429` and not by message text. Log details to the console in development only.
  - **data, optional:** keep `cause` but set `message: "Unexpected error"` for `Unknown`.
- **Status:** open (ui).

### SR-20 (info) Future migrations must repeat the function EXECUTE revoke/grant block

- **Location:** `supabase/migrations/*` (every future migration).
- **Description:** Supabase's default privileges grant EXECUTE on every new function in `public` to `anon`, `authenticated` and `service_role`, and grant table privileges on new tables. The init migration revokes these explicitly. A later migration without that block would quietly expose a new function or table to `anon`. For a SECURITY DEFINER function, that bypasses RLS.
- **Recommendation:**
  - Every migration that creates a function or table repeats the pattern: revoke from `public, anon, authenticated`, then explicit grants, plus `set search_path = ''` and an owner.
  - Extend `verify.sql`'s structural checks ("anon has no EXECUTE on any `public` function"; "every DEFINER function has an empty `search_path`").
- **Status:** open (process item for db).

### SR-21 (info) CodeQL first analysis on `main`: one `js/xss-through-dom` alert, false positive

- **Location:** `.github/workflows/codeql.yml`; code scanning alert #1 at `src/components/ListsDashboard.tsx:78` (columns 29-45, the `href` template literal).
- **Description:** The `codeql` check ran on PR #16 with 0 alerts (run `43575424614`), but PR analysis only covers changed lines. The first analysis on `main` (commit `5a53248`) scanned `src/` and opened one alert: #1, `js/xss-through-dom` ("DOM text reinterpreted as HTML", severity high, CWE-79/116). Message: "DOM text is reinterpreted as HTML without escaping meta-characters."
  - CodeQL's flow: the title typed into the `input` (`e.target.value`, line 67) goes to `setTitle`, then `createList(db, title)`, which returns `{ ...toList(data), role, memberId }` from Supabase (`src/lib/lists/lists.ts`). It is stored in `lists` state, and `l.id` is used in `href={`/lists/${l.id}`}` (line 78). CodeQL treats the whole returned object as tainted, so `l.id` looks like a tainted URL.
  - Triage: false positive. (1) `l.id` is never the title. `createList` inserts only `{ title }`; the id is the server-generated uuid primary key, and a `uuid` column rejects any other text (SR-11: clients may choose the key, but it is still a uuid). (2) The href has a fixed `/lists/` prefix, so it is a same-origin relative path and cannot become a `javascript:` URL. (3) The title reaches the DOM only as a React text child (line 78), in `aria-label` (line 82) and in `window.confirm` (line 44); React escapes the first two and `confirm` shows plain text. (4) `src/` has no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. (5) Other sinks checked the same way: `TodoItem.tsx:60,62` (`aria-label` with todo title), `ShareDialog.tsx:76,81` (`aria-label` with email), `ListView.tsx` (`router.replace` with fixed strings only), `login/page.tsx:21` (`window.location.origin` plus a fixed path). None builds a URL or HTML from user text.
- **Recommendation:** Hardening applied with no behaviour change: `href={`/lists/${encodeURIComponent(l.id)}`}`. A uuid has no characters that encoding changes, so the URL is identical. This should clear the alert, because CodeQL treats URI encoding as a sanitizer for this query, but only the CodeQL run on the PR can confirm it; CodeQL could not be run locally. If the alert remains, the owner should dismiss it as "false positive" with the reasoning above (this review did not touch the alert).
- **Status:** triaged as a false positive; hardening is in a PR awaiting its CodeQL run. Closed once alert #1 is fixed or dismissed.

## Deploy workflow

The deploy workflow is PR #14, merged as `d73ea75` from head `05a6603` after four review rounds. The final statuses below were checked against the merged `.github/workflows/deploy.yml`, `vercel.json` and `docs/DEPLOY.md`.

What is right:
- Workflow-level `permissions: contents: read`.
- `persist-credentials: false`.
- `environment: production`, with a `required_reviewers` rule (owner) and a deployment branch policy of `protected_branches: true`. Only `main` is protected.
- `concurrency: deploy-production` with `cancel-in-progress: false`.
- Checkout of `workflow_run.head_sha`.
- No job-level secrets.
- The deploy output is checked to be a single `https://` URL before it is written to `GITHUB_ENV`.
- No `pull_request_target`.

### SR-22 (info) `workflow_run` guard is correct

- **Location:** `deploy.yml` `on.workflow_run` (`workflows: [ci]`, `types: [completed]`, `branches: [main]`) and the job `if`.
- **Description:** The guard requires `conclusion == 'success'`, `workflow_run.event == 'push'` and `head_repository.full_name == github.repository`. So a PR run, a fork run or a failed run never deploys.
- **Recommendation:** Keep it.
- **Status:** ok.

### SR-23 (medium) `workflow_dispatch` could deploy any branch to production

- **Location:** `deploy.yml` `on.workflow_dispatch`; first step "Manual runs deploy main only".
- **Description:** Before the fix, a manual run deployed whatever ref was selected, with `--prod` and one approval, and without CI.
- **Recommendation:** Allow manual deploys from `main` only.
- **Status:** fixed at `05a6603`. Two controls now apply:
  - A step guard fails the job when `github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'`.
  - The environment's `protected_branches` policy, under which only `main` is protected.

  Manual runs from `main` still skip CI by design (documented). The approver should confirm that `ci` is green for that SHA.

### SR-24 (medium) `VERCEL_TOKEN` exposure to install scripts

- **Location:** `deploy.yml` steps "Install Vercel CLI", "Preflight", "Pull Vercel settings", "Build", "Deploy".
- **Description:** The earlier revision put the token in the job environment of every step, including the `npx --yes` CLI install and `vercel build`, which both run third-party install scripts. It also passed the token with `--token=`.
- **Recommendation:** Scope the token to the steps that need it, install without scripts, and pass the token by env var.
- **Status:** fixed at `05a6603`:
  - The CLI is installed in its own step with no token and `--ignore-scripts` (`npm install --prefix "$RUNNER_TEMP/vercel-cli" --no-save --ignore-scripts vercel@65.8.0`).
  - `VERCEL_TOKEN` is set only as step env on Preflight, Pull and Deploy. There is no `--token=` flag.
  - Build runs with no token; the reviewer verified the tokenless build.

  **Accepted residual risk:** the Build step runs the repo's install and build scripts before the token-bearing Deploy step. A malicious dependency could tamper with the runner, for example by writing to `$GITHUB_ENV` (such as `NODE_OPTIONS`) or by changing `.vercel/output` or the CLI under `$RUNNER_TEMP`, and so affect the later Deploy step. Mitigations: dependencies come from the lockfile via CI review, Dependabot alerts are on, and every deploy needs an approver.

### SR-25 (low) Secret interpolated into `run:` lines

- **Location:** `deploy.yml` (first revision `1634b53`: `--token="${{ secrets.VERCEL_TOKEN }}"`).
- **Description:** `${{ }}` in `run:` is substituted into the script text before the shell runs, which is the script-injection pattern, and it bakes the secret into the script.
- **Recommendation:** Reference secrets only through `env`.
- **Status:** fixed at `05a6603`. No `${{ secrets.* }}` appears in any `run:` line.

### SR-26 (medium) Repository secrets are not gated by environment approval

- **Location:** where the Vercel secrets are stored; `docs/DEPLOY.md` (credentials table).
- **Description:** Repository secrets are readable by any workflow run on a push, with no approval. Only environment secrets are withheld until the `production` reviewer approves.
- **Recommendation:** Store `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as environment secrets on `production`.
- **Status:** fixed: `docs/DEPLOY.md` at `05a6603` documents environment secrets only. Read-only check (secret names only): there are no repository secrets and no `production` secrets yet. Re-check when they are created.

### SR-27 (low) Smoke-test fallback pointed at a third-party site

- **Location:** `deploy.yml` smoke-test step (an earlier revision).
- **Description:** A fallback URL outside the project could "pass" against a site the project does not control.
- **Recommendation:** Test only project URLs.
- **Status:** fixed at `05a6603`. The step checks `SMOKE_URL` or the deployment URL only, and `docs/DEPLOY.md` states "There is no fallback URL".

### SR-28 (low) Smoke test vs Vercel Deployment Protection

- **Location:** `deploy.yml` "Smoke test"; `docs/DEPLOY.md` "Smoke test" and troubleshooting.
- **Description:** Deployment Protection can answer 401 on the unique deployment URL. The earlier docs suggested relaxing protection to make the check pass.
- **Recommendation:** Test the public production domain, and do not weaken Deployment Protection.
- **Status:** fixed at `05a6603`:
  - The step tests `SMOKE_URL` when it is set. On a 401/403 from the deployment URL, it fails with guidance to set `SMOKE_URL`.
  - `docs/DEPLOY.md` says to set `SMOKE_URL` before the first run.
  - The relax-protection advice is gone.

### SR-29 (low) Vercel CLI pinned to a release only hours old

- **Location:** `deploy.yml` `VERCEL_VERSION`.
- **Description:** The earlier revision pinned `vercel@65.16.0`, which was published hours before.
- **Recommendation:** Pin a release that has been public for at least one to two weeks.
- **Status:** fixed at `05a6603`: `VERCEL_VERSION: 65.8.0`. `npm view vercel time` shows it was published on 2026-10-29, and it is installed with `--ignore-scripts`.

### SR-30 (medium) Vercel's Git integration can bypass the approval gate

- **Location:** `vercel.json`; `docs/DEPLOY.md` (top warning).
- **Description:** If the GitHub repo is connected to the Vercel project, Vercel deploys every push to `main` to production, and every branch to previews, with no GitHub approval. Importing the repo also triggers an immediate production deploy. That makes the `production` environment gate meaningless.
- **Recommendation:**
  - Set `"git": { "deploymentEnabled": false }` in `vercel.json`.
  - Create the Vercel project without importing the repo, and disconnect it if it was already connected.
- **Status:** fixed at `05a6603`. `vercel.json` sets `git.deploymentEnabled: false`, and `docs/DEPLOY.md` warns at the top and explains how to disconnect. **Caveat:** Vercel reads this setting from the commit it would deploy, so it helps only on branches that contain `vercel.json`. Older branches, or a project imported before the file existed, are not covered. Disconnecting the Git integration is the real control.

### SR-31 (low) `vercel link --yes` or a non-interactive shell auto-connects Git

- **Location:** `docs/DEPLOY.md` (`npx vercel@65.8.0 link`, project-creation note).
- **Description:** The docs ask the operator to answer **No** when `vercel link` offers to connect the Git repository. With `--yes`, or in a non-interactive shell, the CLI takes the default and connects the repo, which re-opens the SR-30 bypass for any branch without `vercel.json`.
- **Recommendation:**
  - Document `npx vercel@65.8.0 project add <name>` followed by `vercel link --project <name>`, and never `--yes`.
  - Add a check step: Vercel dashboard > Settings > Git shows no connected repository.
- **Status:** open (docs follow-up T16).

### SR-32 (low) `engines.node >=22` makes Vercel build and run on Node 26

- **Location:** `package.json` `engines.node: ">=22"`; `docs/DEPLOY.md` "Node version".
- **Description:** Vercel resolves `>=22` to the newest Node (26.x) and auto-upgrades. CI, `.nvmrc` and `deploy.yml` use Node 22, so production runs a runtime that CI never tested. The interim advice in `docs/DEPLOY.md` (set Node.js Version to 22.x in project settings) does not work: the `engines` field wins over the project setting. This is a supply and runtime drift risk, not a direct vulnerability.
- **Recommendation:** Change `engines.node` to `22.x` (follow-up T15), and then remove the interim advice from `docs/DEPLOY.md`.
- **Status:** open (follow-up T15, app-shell).

### SR-33 (info) Unapproved `deploy` runs wait in the Actions tab

- **Location:** `deploy.yml` `on.workflow_run`; environment `production`.
- **Description:** Every successful `ci` push run on `main` starts a `deploy` run that waits for approval. Run `43617076316`, for `d73ea75`, is waiting now. `concurrency: deploy-production` keeps one run in progress (the waiting one) and one pending, and GitHub cancels older pending runs. So the queue should stay bounded, but that was not exercised here. Approving an old waiting run deploys an old SHA before the newest one.
- **Recommendation:** Before approving, check that the run's head SHA is the commit you mean to ship. Reject stale runs. The approval itself is the intended control.
- **Status:** accepted (by design).

## UI and auth

These are the UI and auth callback from PR #17 (`59444e2`), reviewed on `main`. They combine my reading of the code with tests by the UI reviewer and the security reviewer.

### SR-34 (info) Auth callback: no open redirect, PKCE exchange, generic errors

- **Location:** `src/app/auth/callback/route.ts`.
- **Description:**
  - `safeNext` accepts only a path that starts with a single `/` not followed by `/` or `\`, and rejects any C0 control character or `\u007f`. Anything else falls back to `/lists`.
  - The redirect is always `${origin}${path}`, with `origin` taken from `new URL(request.url)`.
  - The code exchange is PKCE `exchangeCodeForSession`. Any error or exception redirects to the fixed `/login?error=1`, and the login page shows fixed text.
  - The UI reviewer tested 19 open-redirect payloads (`//`, `/\`, `%2F%2F`, `%5C`, encoded control characters, `/.//`, `/..//`, `@`, unicode, `javascript:`, absolute URLs), and none left the origin.
  - A spoofed `Host` or `X-Forwarded-Host` header does not change the redirect.
- **Recommendation:** Keep `safeNext` as the only way a redirect target is chosen. Add a unit test with those payloads so a refactor cannot regress it.
- **Status:** ok.

### SR-35 (info) CSRF: no exposed surface

- **Location:** `src/app/**/route.ts`; all writes through `@/lib/lists` and `@/lib/sharing`.
- **Description:** The only `route.ts` is the auth callback `GET`, and it only exchanges a one-time PKCE code; it needs the verifier cookie set by the same browser. Every write goes from the browser client to Supabase with the session as a bearer `Authorization` header, not as an ambient cookie on an app endpoint. There are no Server Actions.
- **Recommendation:** If a state-changing `route.ts` or Server Action is added later, verify `Origin` (or `Sec-Fetch-Site: same-origin`) in route handlers, and never change state on `GET`.
- **Status:** ok.

### SR-36 (info) Client bundle, cache headers and XSS sinks: no issues found

- **Location:** `src/components/*`, `src/app/**`.
- **Description:**
  - The client bundle contains no service-role key; only the URL and anon key are in `NEXT_PUBLIC_*`.
  - `/` (`force-dynamic`) and `/lists/[id]` send `Cache-Control: private, no-store`. `/lists` is a static shell and has no user data on the server.
  - There is no `dangerouslySetInnerHTML`; titles and emails are rendered as React text.
  - Links use the uuid ids that come from the database.
  - The `?revoked` and `?error` query flags only toggle fixed messages.
- **Recommendation:** None.
- **Status:** ok.

### SR-37 (info) Sign-out does not await channel removal

- **Location:** `src/components/ListsDashboard.tsx` L52-53 (`db.removeAllChannels();` then `await db.auth.signOut();`).
- **Description:** `removeAllChannels()` returns a promise, and the code does not await it before `signOut()`. The contract only asks for the call order, so this is a nit. Channels may still be leaving when the session ends. RLS and the server-side session end still protect data, so nothing leaks.
- **Recommendation:** `await db.removeAllChannels();` before `signOut()`.
- **Status:** open (ui nit).

### SR-38 (low) Magic-link sending relies on Supabase defaults

- **Location:** `src/app/login/page.tsx` (`signInWithOtp`); Supabase Auth rate limits, SMTP and CAPTCHA settings.
- **Description:** The login form sends a magic link to any email, with no CAPTCHA. Abuse protection is only Supabase's per-email and per-IP rate limits and the configured SMTP's limits. These were not checked, and the built-in SMTP is meant for testing only.
- **Recommendation:**
  - Configure custom SMTP for production, and review the Auth rate limits (email sent, OTP).
  - Consider hCaptcha or Turnstile on sign-in.
  - Show the same result whether or not the email has an account (see SR-19).
- **Status:** open (config; not verified).

## Not verified

- **Live RLS on a real Supabase project.** `verify.sql` passed only on a stubbed Postgres (`docs/DATABASE.md`). No live Supabase calls were allowed.
- **Realtime assumptions A1 and A2** (`contracts/realtime.md`). Both need a live Realtime server. See SR-02 and SR-04.
- **Supabase Auth dashboard settings** (confirm email, secure email change, password signups, anonymous sign-ins, rate limits, redirect URLs, SMTP, CAPTCHA). There is no access to the project.
- **CodeQL on `main`.** The PR #16 run (0 alerts) covered only lines changed by that PR, which has no JS or TS. The first `push` analysis on `main` (commit `5a53248`) did scan `src/` and found one alert, triaged in SR-21 as a false positive. CodeQL could not be run locally; the effect of the fix is confirmed only by the PR's CodeQL run.
- **Vercel project configuration** (Git connection, Node version, env vars, Deployment Protection, domains, token scope). There is no Vercel access. SR-30 to SR-32 depend on it.
- **Deploy runtime behaviour.** No deploy has run yet (run `43617076316` is waiting for approval). The step guard, the tokenless build, and the bounded concurrency queue (SR-33) were checked by reading the code and through the reviewer's verification, not by a production run.
- **UI behaviour I did not test myself.** The 19 open-redirect payloads, the Host/X-Forwarded-Host spoofing, the cache headers and the client-bundle check were done by the UI reviewer and the security reviewer. I verified them only by reading the code.
