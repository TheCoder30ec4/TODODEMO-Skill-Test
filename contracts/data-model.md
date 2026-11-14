# Data model

Schema `public`. All tables have RLS enabled (see `rls.md`). Timestamps are `timestamptz`, default `now()`. App types in `types.ts` are the camelCase mapping of these columns.

Every table has a single `id uuid` primary key. Realtime DELETE payloads carry only the PK to every subscriber (see `realtime.md`), so they expose nothing but a random uuid.

## lists

| column | type | null | default | notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| owner_id | uuid | no | `auth.uid()` | FK `auth.users(id)` ON DELETE CASCADE |
| title | text | no | | CHECK `char_length(btrim(title)) between 1 and 200` |
| created_at | timestamptz | no | `now()` | |

Indexes: `lists_owner_id_idx (owner_id)`.

## todos

| column | type | null | default | notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| list_id | uuid | no | | FK `lists(id)` ON DELETE CASCADE |
| title | text | no | | CHECK `char_length(btrim(title)) between 1 and 500` |
| done | boolean | no | `false` | |
| position | integer | no | `0` | CHECK `position >= 0`; not unique (ties broken by created_at, id) |
| created_by | uuid | yes | `auth.uid()` | FK `auth.users(id)` ON DELETE SET NULL |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | set to `now()` by BEFORE UPDATE trigger `todos_set_updated_at`; server clock, the only merge-ordering key |

Indexes: `todos_list_id_position_idx (list_id, position)`.

## list_members

| column | type | null | default | notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| list_id | uuid | no | | FK `lists(id)` ON DELETE CASCADE |
| email | text | no | | CHECK `email = lower(btrim(email))` and CHECK `email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'` |
| role | text | no | | CHECK `role in ('viewer','editor')` |
| added_by | uuid | yes | `auth.uid()` | FK `auth.users(id)` ON DELETE SET NULL |
| created_at | timestamptz | no | `now()` | |

Constraints: UNIQUE `list_members_list_id_email_key (list_id, email)` (also serves lookups by list). Indexes: `list_members_email_idx (email)`. No FK to `auth.users` on email: the row may exist before the invitee has an account.

## Cascade summary

- Delete user -> their `lists` deleted -> those lists' `todos` and `list_members` deleted.
- Delete user -> `todos.created_by` / `list_members.added_by` set NULL on other lists.
- Delete list -> its `todos` and `list_members` deleted.

## Privileges

Revoke first, then grant explicitly:

1. `revoke all on table public.lists, public.todos, public.list_members from public, anon, authenticated;`
2. Grant SELECT, INSERT, DELETE on all three tables to `authenticated`.
3. Grant column UPDATE to `authenticated` only. Other columns stay immutable for clients whatever the policy says:
   - `lists`: UPDATE (`title`)
   - `todos`: UPDATE (`title`, `done`, `position`)
   - `list_members`: UPDATE (`role`)
4. For every function below: `revoke all on function ... from public, anon, authenticated;` then `grant execute ... to authenticated`. The trigger function needs no grant.

`anon` has no privileges.

## Functions

Every function is owned by `postgres`, declared with `set search_path = ''`, and uses fully qualified names (`public.lists`, `auth.users`, `auth.uid()`).

**Caller email** in this file means the caller's *confirmed* email, read from `auth.users` and never from the JWT: `(select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)`. A caller with no confirmed email matches no member row.

| function | security | purpose |
|---|---|---|
| `public.list_role(p_list_id uuid) returns text` | DEFINER, STABLE | `'owner'` if `public.lists.owner_id = auth.uid()`; else the `role` of the `public.list_members` row with `list_id = p_list_id` and `email` = caller email; else NULL. The owner wins over any member row. Every policy uses it. DEFINER avoids the lists <-> list_members policy recursion and allows reading `auth.users`. |
| `public.my_role(l public.lists) returns text` | INVOKER, STABLE | PostgREST computed field: `public.list_role(l.id)`. Selectable as column `my_role` on `lists`. |
| `public.my_member_id(l public.lists) returns uuid` | DEFINER, STABLE | PostgREST computed field: `id` of the caller's own `list_members` row for `l.id`, matched by caller email. NULL for the owner and non-members. Selectable as column `my_member_id`. |
| `public.reorder_todos(p_list_id uuid, p_ids uuid[]) returns void` | INVOKER, VOLATILE | Atomic reorder. Raises `P0001` with message `not_found` if `list_role(p_list_id)` is NULL, `forbidden` if it is `'viewer'`, and `conflict` if `p_ids` is not exactly the set of todo ids in the list (no missing, extra or duplicate ids). Otherwise sets `position = array index - 1` (0-based) for each id. |
| `public.todos_set_updated_at()` trigger fn | INVOKER | `new.updated_at := now()` |

## Realtime

`alter publication supabase_realtime add table public.lists, public.todos, public.list_members;` Replica identity stays default, so DELETE `old` carries `{ id }` only. See `realtime.md`.
