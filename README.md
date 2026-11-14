# TODODEMO

Shareable, realtime to-do lists. Create a list, share it with others by email, and everyone sees changes live. Built with Next.js, Supabase (Postgres, Auth, Realtime) and built to be deployed to Vercel through the approval-gated GitHub workflow (not deployed yet; see docs/DEPLOY.md).

## Prerequisites

- Node.js 22.x (`engines.node` is `22.x`; see `.nvmrc`). Newer majors such as 24 print an engine warning on `npm ci`, which is intended. It is only a warning, not an error (there is no `.npmrc` with `engine-strict`).
- A Supabase project (hosted, or local via the Supabase CLI)

## Local setup

1. `npm ci`
2. `cp .env.example .env.local`
3. Create a Supabase project and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (Project Settings > API).
4. Apply the migrations in `supabase/migrations` and configure auth as described in [docs/DATABASE.md](docs/DATABASE.md).
5. `npm run dev` and open http://localhost:3000.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (single run) |

## Project layout

- `contracts/` - the shared specs (data model, RLS, data API, realtime) and `types.ts`; source of truth for the app and database
- `src/` - the Next.js app (`src/app`) and shared code (`src/lib`)
- `supabase/` - SQL migrations and `tests/verify.sql`
- `docs/` - operational docs
- `vercel.json` - security headers; turns off Vercel's Git deployments so deploys go only through the approval-gated GitHub workflow

## How sharing works

A list belongs to its owner. The owner shares it by entering an email address and a role (editor or viewer). A share matches only the confirmed email of a signed-in user (never an unverified email claim), and Postgres row level security enforces access, so the client never decides who may read or write. Editors and viewers can see the emails of the other members of lists they belong to. See `contracts/rls.md`.

**Caveat:** the row level security rules were verified only with `supabase/tests/verify.sql` on a stubbed Postgres (hand-written Supabase stubs), not on a real Supabase project. Magic-link sign-in end to end and realtime delivery between two users have not yet been exercised against a real project. See "Not verified" in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md), and [docs/DATABASE.md](docs/DATABASE.md) for running `verify.sql` on a real project.

## How realtime works

Clients subscribe to Supabase Realtime `postgres_changes` for the list they have open. INSERT and UPDATE events are checked against the read policies, so a user only receives rows they may read. DELETE events are not filtered: every subscribed client receives the `id` of every delete across all lists. Ids are random uuids, so no emails or titles leak. Two assumptions are still unverified (see "Assumptions to verify" in `contracts/realtime.md`): A1, that DELETE events are not filtered or RLS-checked, and A2, that the functions used inside policies see the subscriber's JWT claims.

## Docs

- [docs/DATABASE.md](docs/DATABASE.md) - schema, migration, verification, auth settings
- [docs/DEPLOY.md](docs/DEPLOY.md) - Vercel deployment
- [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) - security review
- [SECURITY.md](SECURITY.md) - security policy
