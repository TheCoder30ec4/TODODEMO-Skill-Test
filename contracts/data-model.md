# Data model

Schema `public`. All tables have RLS enabled (see `rls.md`). Timestamps are `timestamptz`, default `now()`. App types in `types.ts` are the camelCase mapping of these columns.

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
| updated_at | timestamptz | no | `now()` | set to `now()` by BEFORE UPDATE trigger `todos_set_updated_at` |

Indexes: `todos_list_id_position_idx (list_id, position)`.

## list_members

| column | type | null | default | notes |
|---|---|---|---|---|
| list_id | uuid | no | | FK `lists(id)` ON DELETE CASCADE |
| email | text | no | | CHECK `email = lower(btrim(email))` and CHECK `email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'` |
| role | text | no | | CHECK `role in ('viewer','editor')` |
| added_by | uuid | yes | `auth.uid()` | FK `auth.users(id)` ON DELETE SET NULL |
| created_at | timestamptz | no | `now()` | |

PK `(list_id, email)`. Indexes: `list_members_email_idx (email)` (membership lookup by JWT email). No FK to `auth.users` on email: the row may exist before the invitee has an account.

## Cascade summary

- Delete user -> their `lists` deleted -> those lists' `todos` and `list_members` deleted.
- Delete user -> `todos.created_by` / `list_members.added_by` set NULL on other lists.
- Delete list -> its `todos` and `list_members` deleted.

## Column privileges (role `authenticated`)

Revoke table-wide UPDATE, then grant column UPDATE only. This makes non-listed columns immutable for clients regardless of policy:

- `lists`: UPDATE (`title`)
- `todos`: UPDATE (`title`, `done`, `position`)
- `list_members`: UPDATE (`role`)

SELECT, INSERT, DELETE granted on all three tables; RLS decides rows. `anon` gets no privileges.

## Functions

| function | security | purpose |
|---|---|---|
| `list_role(p_list_id uuid) returns text` | DEFINER, STABLE, `search_path = public` | `'owner'` if `lists.owner_id = auth.uid()`; else `list_members.role` where `email = lower(auth.jwt()->>'email')`; else NULL. Owner wins over any member row. Used by every policy (DEFINER avoids lists <-> list_members policy recursion). EXECUTE to `authenticated`. |
| `reorder_todos(p_list_id uuid, p_ids uuid[]) returns void` | INVOKER | Atomic reorder. Raises `P0001` with message `not_found` if `list_role(p_list_id)` is NULL, `forbidden` if it is `'viewer'`, `conflict` if `p_ids` is not exactly the set of todo ids in the list (no missing, extra or duplicate ids). Else sets `position = array index - 1` (0-based) for each id. EXECUTE to `authenticated`. |
| `todos_set_updated_at()` trigger fn | INVOKER | `new.updated_at := now()` |

## Realtime

`alter publication supabase_realtime add table public.lists, public.todos, public.list_members;` Replica identity default (DELETE `old` carries PK only). See `realtime.md`.
