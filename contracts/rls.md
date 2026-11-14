# Row Level Security

RLS enabled on `lists`, `todos`, `list_members`. All policies are `TO authenticated`; `anon` has no access. Membership is matched only by `lower(auth.jwt()->>'email')`, through `list_role(list_id)` (see `data-model.md`), which returns `'owner' | 'editor' | 'viewer' | NULL`. Non-member = NULL.

Column privileges (data-model.md) apply in addition: even when a policy allows UPDATE, only the granted columns can change.

## lists

| op | policy | owner | editor | viewer | non-member |
|---|---|---|---|---|---|
| SELECT | USING `owner_id = auth.uid() or list_role(id) is not null` (the direct owner check is required so `insert ... returning` works: a STABLE function does not see the row inserted by the same statement) | yes | yes | yes | no |
| INSERT | WITH CHECK `owner_id = auth.uid()` | any authenticated user may create; becomes owner | same | same | same |
| UPDATE (`title`) | USING `owner_id = auth.uid()` WITH CHECK `owner_id = auth.uid()` | yes | no | no | no |
| DELETE | USING `owner_id = auth.uid()` | yes | no | no | no |

Ownership cannot be transferred (`owner_id` not updatable).

## todos

| op | policy | owner | editor | viewer | non-member |
|---|---|---|---|---|---|
| SELECT | USING `list_role(list_id) is not null` | yes | yes | yes | no |
| INSERT | WITH CHECK `list_role(list_id) in ('owner','editor') and created_by = auth.uid()` | yes | yes | no | no |
| UPDATE (`title`,`done`,`position`) | USING and WITH CHECK `list_role(list_id) in ('owner','editor')` | yes | yes | no | no |
| DELETE | USING `list_role(list_id) in ('owner','editor')` | yes | yes | no | no |

`list_id`, `created_by`, `created_at` are not updatable, so a todo cannot be moved to another list or reattributed. `updated_at` is set by trigger only.

## list_members

| op | policy | owner | editor | viewer | non-member |
|---|---|---|---|---|---|
| SELECT | USING `list_role(list_id) is not null` | all rows of the list | all rows of the list | all rows of the list | no |
| INSERT | WITH CHECK `list_role(list_id) = 'owner' and added_by = auth.uid()` | yes | no | no | no |
| UPDATE (`role`) | USING and WITH CHECK `list_role(list_id) = 'owner'` | yes | no | no | no |
| DELETE | USING `list_role(list_id) = 'owner'` | yes | no | no | no |

## No self-escalation

- Editors and viewers have no INSERT/UPDATE/DELETE policy on `list_members`, so they cannot change their own role, add themselves or others, or remove anyone (including themselves; leaving a list is out of scope).
- Only `role` is updatable, so `list_id`/`email` cannot be rewritten to grant access elsewhere.
- A member row grants access only to a JWT whose email equals `list_members.email`; nobody can claim access by inserting a row for their own email on a list they do not own.
- `list_role` returns `'owner'` only from `lists.owner_id`; a member row can never yield `'owner'`.

## Error surface (how RLS outcomes look to the data layer)

- SELECT of an invisible row: 0 rows (map to `NotFound`; never reveal existence).
- INSERT failing WITH CHECK: Postgres `42501` (map to `Forbidden`).
- UPDATE/DELETE with USING false: 0 rows affected, no error (data layer maps per `data-api.md`).
