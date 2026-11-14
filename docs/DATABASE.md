# Database

Schema, RLS and functions are defined in `supabase/migrations/20260101000000_init.sql` (implements `contracts/data-model.md` and `contracts/rls.md`). The migration is idempotent.

## Apply the migration

- **SQL editor:** Supabase dashboard > SQL Editor > paste the whole file > Run.
- **CLI:** `supabase link --project-ref <ref>` then `supabase db push`.

The migration assumes it runs as `postgres` (functions are `alter ... owner to postgres`). Do not enable FORCE ROW LEVEL SECURITY on these tables: the SECURITY DEFINER helpers rely on owner bypass.

## Verify

Run `supabase/tests/verify.sql` in the SQL editor (or `psql "$DATABASE_URL" -f supabase/tests/verify.sql`). It creates throwaway users and data in one transaction, checks the role matrix (owner, editor, viewer, non-member, unconfirmed-email user, forged JWT email, anon) per table and operation, the column grants, `reorder_todos`, structural RLS checks, and cascades, then rolls back. Any failure raises `VERIFY FAILED: <check>`; success prints `NOTICE: verify.sql: ALL CHECKS PASSED`. Run it against a dev or local project, not production.

## Auth settings (Dashboard > Authentication)

- Providers: **Email** enabled.
- Magic link / email OTP enabled (passwordless sign-in).
- **Confirm email: ON.** Membership matches only `auth.users.email` with `email_confirmed_at` set.
- URL Configuration:
  - Site URL: the production Vercel URL.
  - Redirect URLs: `https://<your-vercel-domain>/auth/callback`, `https://*-<team>.vercel.app/auth/callback` (previews, optional) and `http://localhost:3000/auth/callback`.

## Realtime

The migration adds `lists`, `todos` and `list_members` to the `supabase_realtime` publication (skipped if the publication does not exist). Confirm in Dashboard > Database > Replication (or Realtime), or:

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

Replica identity stays default (DELETE `old` = `{ id }`). If a table is not listed, toggle it on in the dashboard.

## Confirm the unverified Realtime assumptions (A1, A2)

Not verified by T4: these need a live Realtime server. Follow the test in `contracts/realtime.md` ("Verification tests", data) with two or three real clients, or in the dashboard Realtime Inspector:

- **A2** (INSERT/UPDATE reach members only): A creates a list and shares it with B (editor). B and non-member C subscribe to `todos` with `list_id=eq.<id>`. A adds a todo. B must receive the event within 5 s; C must receive nothing. Also test viewer V and the unconfirmed-email user receive nothing/receive per role. If C receives it, `auth.uid()` inside `list_role` is not seeing the subscriber JWT: report it.
- **A1** (DELETE unfiltered, id-only): A deletes the todo. Record whether C receives a DELETE and that `old` is only `{ id }`. Receiving it confirms A1; not receiving it is safe but must be reported.
