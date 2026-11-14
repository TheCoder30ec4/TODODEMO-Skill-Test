# Deploying to Vercel

> **Read first:** the GitHub environment `production`, **with required reviewers**, must exist before the first run. If it is missing, GitHub silently creates an unprotected one and the job runs with **no approval**. For this repo it already exists with the owner as required reviewer. Verify any time:
> `gh api repos/TheCoder30ec4/TODODEMO-Skill-Test/environments/production` (look for a `required_reviewers` rule in `protection_rules`).

## What gets deployed and how the gate works

The Next.js app is deployed to Vercel by GitHub Actions (`.github/workflows/deploy.yml`).

1. You merge to `main`. The `ci` workflow runs (lint, typecheck, build, tests).
2. When `ci` **succeeds on a push to main**, `deploy` starts. It never runs on pull requests or after a CI failure.
3. The deploy job is bound to the `production` environment. GitHub **pauses it until a required reviewer approves**. Nothing is built or sent to Vercel, and the environment secrets stay unreadable, before you click Approve.
4. After approval: a preflight check for the three secrets, `vercel pull`, `vercel build --prod`, `vercel deploy --prebuilt --prod`, then a smoke test.

Notes:
- A manual run (Actions, deploy, Run workflow) deploys the chosen ref **without waiting for CI**. It is still gated by the reviewer approval, so check CI yourself first.
- Deploys queue one at a time (a running deploy is never cancelled). The Vercel CLI is pinned to `vercel@65.16.0` (latest at the time of writing; bump deliberately).

## Credentials: what, where from, where it goes

Never paste a secret into chat, a file, or a commit. Type it when `gh` prompts for it.

| Name | Where to get it | Where it goes |
|---|---|---|
| `VERCEL_TOKEN` | vercel.com/account/tokens, create a token | GitHub **environment secret** on `production` |
| `VERCEL_ORG_ID` | run `npx vercel link`, then read `orgId` in `.vercel/project.json` | GitHub **environment secret** on `production` |
| `VERCEL_PROJECT_ID` | same file, `projectId` | GitHub **environment secret** on `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard, Project Settings, API (Project URL) | **Vercel** project env var, Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard, Project Settings, API Keys (or API): the `anon` / public key | **Vercel** project env var, Production |
| `SMOKE_URL` (optional, not secret) | your public production alias, e.g. your custom domain | GitHub **repository variable** |

Why environment secrets: repository secrets can be read by any workflow run on a push, with no approval. Environment secrets are withheld until the `production` job is approved, so they are the ones to use.

Notes:
- The Vercel project must already exist (create it in the Vercel dashboard; `npx vercel link` can also create it). `.vercel/` is local only; do not commit it.
- The two Supabase values are public client keys, but keep them out of the repo anyway.
- **Never use or store the Supabase service-role key** here, in GitHub, or in Vercel. This app does not need it.

### Storing them

```sh
npx vercel login
npx vercel link                              # then: cat .vercel/project.json
gh secret set VERCEL_TOKEN --env production        # prompts; type or paste the value
gh secret set VERCEL_ORG_ID --env production
gh secret set VERCEL_PROJECT_ID --env production
gh variable set SMOKE_URL                    # optional, e.g. https://your-domain
```

Supabase values for the Vercel build: Vercel dashboard, your project, Settings, Environment Variables, tick **Production** only. Or:

```sh
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
```

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

## Create the `production` environment with required reviewers

Skip if it already exists (see the note at the top; it does for this repo).

- GitHub: repo, Settings, Environments, New environment, name it exactly `production`, tick **Required reviewers**, add yourself, Save. Optionally limit deployment branches to `main`.
- Or with the orchestrator: `deploy plan --apply --yes`. Review its plan first.

Required reviewers on a private repo need a paid GitHub plan; on a free private repo the gate is not enforced, so do not deploy from it.

## Supabase setup

1. **Apply the migration** in `supabase/migrations/` to the production project: `supabase link --project-ref <ref>` then `supabase db push`, or paste the SQL into the dashboard SQL editor. Then run `supabase/tests/verify.sql` (see `docs/DATABASE.md`).
2. **Auth, URL configuration:** Site URL = your Vercel production URL. Redirect URLs must include `https://<your-production-url>/auth/callback`. (The `/auth/callback` route itself is added by the UI task, PR #17; add the redirect URL now anyway.)
3. **Auth, Providers:** Email enabled, **Confirm email** on.

## First deploy walkthrough

1. Finish the credentials, the `production` environment check, and Supabase setup above.
2. Merge a PR to `main`. Wait for `ci` to go green.
3. Open the Actions tab, the `deploy` run: it shows "Waiting for review". Click **Review deployments**, tick `production`, **Approve and deploy**.
4. Watch the steps. Green means Vercel accepted the deploy and the smoke test saw HTTP 200.
5. Optionally set the `SMOKE_URL` variable to your public alias, add the real URL to the Supabase Site URL and redirect URLs, and sign up once to check auth.

## Smoke test

The workflow captures the deployment URL that `vercel deploy` prints and requests it (follows redirects, 15 s timeout per try, up to 12 tries 10 s apart, so about two minutes). Any status other than 200 fails the job. If the repository variable `SMOKE_URL` is set, that URL is checked the same way. There is no fallback URL: when `SMOKE_URL` is unset, only the deployment URL is tested. This checks that the site responds, not that every feature works; click through sign-up and a to-do after the first deploy.

## Rollback

- Fast: `npx vercel rollback` (or Vercel dashboard, Deployments, pick a previous good one, Promote to Production). Immediate; git is untouched.
- Permanent: `git revert <merge-commit>` and open a PR. Merging it triggers a normal gated deploy.
- Database migrations are not rolled back by either step. Write a new forward migration if the schema is the problem.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `deploy` never starts after merge | `ci` failed or is still running; deploy follows only a successful CI push run. Or start it manually. |
| Run stuck on "Waiting for review" | Expected. A required reviewer must approve it. |
| Job ran with **no approval prompt** | The `production` environment was missing or has no required reviewers, so GitHub created/used an unprotected one. Add reviewers now (see top note) and consider rotating the Vercel token. |
| Preflight: `Missing secrets on the production environment: ...` | Set them with `gh secret set NAME --env production` (repository-level secrets are intentionally not what is documented). |
| `No existing credentials found` / `Invalid token` | `VERCEL_TOKEN` expired or wrong; create a new token and set it again. |
| `Project not found` / `orgId` errors | `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` wrong; re-read `.vercel/project.json`. |
| Build fails: missing `NEXT_PUBLIC_SUPABASE_*` | Add both as Vercel env vars for **Production**, then rerun. |
| Smoke test fails on the deployment URL with 401/403 | Vercel Deployment Protection covers the unique deployment URL. Allow it for production in Vercel project settings, or accept that only `SMOKE_URL` is meaningful. |
| Smoke test fails on `SMOKE_URL` with 404 or DNS error | The variable points at the wrong or not-yet-connected domain; fix or delete the variable. |
| Sign-in link goes to wrong site or errors | Supabase Site URL / redirect URLs missing the production URL and `/auth/callback`. |
| No confirmation email | Email provider off, or Supabase default mail rate limit; check Auth settings and logs. |
