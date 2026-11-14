# Deploying to Vercel

## What gets deployed and how the gate works

The Next.js app is deployed to Vercel by GitHub Actions (`.github/workflows/deploy.yml`).

1. You merge to `main`. The `ci` workflow runs (lint, typecheck, build, tests).
2. When `ci` **succeeds on a push to main**, the `deploy` workflow starts. It never runs on pull requests, and it does not run if CI failed. You can also start it by hand (Actions, deploy, Run workflow).
3. The deploy job is bound to the GitHub environment `production`. GitHub **pauses it until a required reviewer approves** it. Nothing is built or sent to Vercel before you click Approve.
4. After approval: `vercel pull`, `vercel build --prod`, `vercel deploy --prebuilt --prod`, then a smoke test that fails the job unless the site answers HTTP 200.

Deploys are queued one at a time (no cancelling a running deploy). The Vercel CLI is pinned to `vercel@41.0.0`.

> **PLACEHOLDER URL:** the workflow checks `https://todo-demo.vercel.app` because the real URL is not known yet. After the first deploy, set the repository variable `SMOKE_URL` to the real production URL (Settings, Secrets and variables, Actions, Variables, or `gh variable set SMOKE_URL`). Until then the smoke test may fail or test the wrong site.

## Credentials: what, where from, where it goes

Never paste a secret into chat, a file, or a commit. Type it when `gh` prompts for it.

| Name | Where to get it | Where it goes |
|---|---|---|
| `VERCEL_TOKEN` | vercel.com/account/tokens, create a token | GitHub **secret**: `gh secret set VERCEL_TOKEN` |
| `VERCEL_ORG_ID` | run `vercel link` in the repo, then read `orgId` in `.vercel/project.json` | GitHub **secret**: `gh secret set VERCEL_ORG_ID` |
| `VERCEL_PROJECT_ID` | same file, `projectId` | GitHub **secret**: `gh secret set VERCEL_PROJECT_ID` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard, Project Settings, API, Project URL | **Vercel** project env var, Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard, Project Settings, API, `anon` `public` key | **Vercel** project env var, Production |
| `SMOKE_URL` (optional, not secret) | your real production URL | GitHub **variable**: `gh variable set SMOKE_URL` |

Notes:
- The Vercel project must already exist (create it in the Vercel dashboard, or `vercel link` offers to). `.vercel/` is local only; do not commit it.
- The two Supabase values are public client keys, but they are still configuration: keep them out of the repo.
- **Never use or store the Supabase service-role key** here, in GitHub, or in Vercel. This app does not need it.
- Repository secrets work for the `production` environment job. If you prefer, store the three Vercel secrets as environment secrets instead (`gh secret set NAME --env production`).

### Storing them

```sh
gh secret set VERCEL_TOKEN        # prompts; type or paste the value
gh secret set VERCEL_ORG_ID
gh secret set VERCEL_PROJECT_ID
```

Supabase values for the Vercel build (the dashboard: Project, Settings, Environment Variables, tick Production only), or:

```sh
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
```

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

## Create the `production` environment with required reviewers

Do this before the first deploy, otherwise the job has no approval gate.

- GitHub: repo, Settings, Environments, New environment, name it exactly `production`, tick **Required reviewers**, add yourself, Save. Optionally restrict deployment branches to `main`.
- Or with the orchestrator: `deploy plan --apply --yes` (see the orchestrator docs). Review its plan first.

Required reviewers on a private repo need a paid GitHub plan. On a free private repo the gate is not enforced, so do not deploy from it.

## Supabase setup

1. **Apply the migration** in `supabase/migrations/` to the production project: `supabase link --project-ref <ref>` then `supabase db push`, or paste the SQL file into the dashboard SQL editor. Then run `supabase/tests/verify.sql` to check it (see `docs/DATABASE.md`).
2. **Auth, URL configuration:** Site URL = your Vercel production URL. Redirect URLs must include `https://<your-production-url>/auth/callback`.
3. **Auth, Providers:** Email enabled, **Confirm email** on.

## First deploy walkthrough

1. Finish the credentials, the `production` environment, and Supabase setup above.
2. Merge a PR to `main`. Wait for `ci` to go green.
3. Open the Actions tab, the `deploy` run: it shows "Waiting for review". Click **Review deployments**, tick `production`, **Approve and deploy**.
4. Watch the steps. A green run means Vercel accepted the deploy and the smoke test saw HTTP 200.
5. Set `SMOKE_URL` (see the placeholder note), update the Supabase Site URL and redirect URLs with the real URL, and sign up once to check auth.

## Smoke test

The last step does `GET $SMOKE_URL` (follows redirects, retries for about a minute) and fails the job on any status other than 200. It checks that the site responds, not that every feature works; click through sign-up and a to-do after the first deploy.

## Rollback

- Fast: `vercel rollback` (or Vercel dashboard, Deployments, pick a previous good one, Promote to Production). This takes effect immediately and does not touch git.
- Permanent: `git revert <merge-commit>` and open a PR. Merging it triggers a normal gated deploy.
- Database migrations are not rolled back by either step. Write a new forward migration if the schema is the problem.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `deploy` never starts after merge | `ci` failed or is still running; the deploy only follows a successful CI push run. Or start it manually (workflow_dispatch). |
| Run stuck on "Waiting for review" | Expected. A required reviewer must approve it. |
| Job fails immediately, no approval asked | The `production` environment does not exist or has no reviewers; create it. |
| `No existing credentials found` / `Invalid token` | `VERCEL_TOKEN` missing, expired, or wrong scope; create a new token and `gh secret set VERCEL_TOKEN`. |
| `Project not found` / `orgId` errors | `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` wrong; re-read `.vercel/project.json`. |
| Build fails: missing `NEXT_PUBLIC_SUPABASE_*` | Add both as Vercel env vars for **Production**, then rerun. |
| Smoke test fails, HTTP 404 or DNS error | `SMOKE_URL` still the placeholder; set it to the real URL. |
| Smoke test fails, 401/403 | Vercel deployment protection is on for the URL; disable it for production or use the public domain. |
| Sign-in link goes to wrong site or errors | Supabase Site URL / redirect URLs missing the production URL and `/auth/callback`. |
| No confirmation email | Email provider off, or Supabase default mail rate limit; check Auth settings and logs. |
