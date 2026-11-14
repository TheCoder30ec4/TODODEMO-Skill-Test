# TODODEMO

Shareable, realtime to-do lists. Create a list, share it with others by email, and everyone sees changes live. Built with Next.js, Supabase (Postgres, Auth, Realtime) and deployed on Vercel.

## Prerequisites

- Node.js 22 or newer (`engines` requires `>=22`)
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

## How sharing works

A list belongs to its owner. The owner shares it by entering an email address and a role (editor or viewer). Membership matches the confirmed email of a signed-in user, and Postgres row level security enforces access, so the client never decides who may read or write. See `contracts/rls.md`.

## How realtime works

Clients subscribe to Supabase Realtime changes for the lists they can open. Row level security applies to those events too, so members only receive changes for lists they belong to. See `contracts/realtime.md`.

## Docs

- [docs/DATABASE.md](docs/DATABASE.md) - schema, migration, verification, auth settings
- `docs/DEPLOY.md` - Vercel deployment (coming in a later task)
