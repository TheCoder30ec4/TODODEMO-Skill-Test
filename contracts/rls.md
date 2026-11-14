# Row Level Security

RLS is enabled on `lists`, `todos` and `list_members`. All policies are `TO authenticated`; `anon` has no access.

Membership is matched through `public.list_role(list_id)` (see `data-model.md`), which returns `'owner' | 'editor' | 'viewer' | NULL`. Non-member = NULL. A member row matches only the caller's **confirmed** email from `auth.users` (`email_confirmed_at is not null`). It never matches `auth.jwt()->>'email'`, so an unverified or forged email claim grants nothing.

Column privileges (data-model.md) apply on top of these policies: even when a policy allows UPDATE, only the granted columns can change.

## lists

| op | policy | owner | editor | viewer | non-member |
|---|---|---|---|---|---|
| SELECT | USING `owner_id = auth.uid() or public.list_role(id) is not null`. The direct owner check is required so `insert ... returning` works, because a STABLE function does not see the row inserted by the same statement. | yes | yes | yes | no |
| INSERT | WITH CHECK `owner_id = auth.uid()` | any authenticated user may create; becomes owner | same | same | same |
| UPDATE (`title`) | USING `owner_id = auth.uid()` WITH CHECK `owner_id = auth.uid()` | yes | no | no | no |
| DELETE | USING `owner_id = auth.uid()` | yes | no | no | no |

Ownership cannot be transferred because `owner_id` is not updatable.

## todos

| op | policy | owner | editor | viewer | non-member |
|---|---|---|---|---|---|
| SELECT | USING `public.list_role(list_id) is not null` | yes | yes | yes | no |
| INSERT | WITH CHECK `public.list_role(list_id) in ('owner','editor') and created_by = auth.uid()` | yes | yes | no | no |
| UPDATE (`title`,`done`,`position`) | USING and WITH CHECK `public.list_role(list_id) in ('owner','editor')` | yes | yes | no | no |
| DELETE | USING `public.list_role(list_id) in ('owner','editor')` | yes | yes | no | no |

`list_id`, `created_by` and `created_at` are not updatable, so a todo cannot be moved to another list or reattributed. Only the trigger sets `updated_at`.

## list_members

| op | policy | owner | editor | viewer | non-member |
|---|---|---|---|---|---|
| SELECT | USING `public.list_role(list_id) is not null` | all rows of the list | all rows of the list | all rows of the list | no |
| INSERT | WITH CHECK `public.list_role(list_id) = 'owner' and added_by = auth.uid()` | yes | no | no | no |
| UPDATE (`role`) | USING and WITH CHECK `public.list_role(list_id) = 'owner'` | yes | no | no | no |
| DELETE | USING `public.list_role(list_id) = 'owner'` | yes | no | no | no |

Editors and viewers seeing every collaborator's email on lists they belong to is **intentional** (same as shared documents). Non-members see none.

## No self-escalation

- Editors and viewers have no INSERT, UPDATE or DELETE policy on `list_members`. They cannot change their own role, add themselves or others, or remove anyone, including themselves. Leaving a list is out of scope.
- Only `role` is updatable, so `list_id` and `email` cannot be rewritten to grant access elsewhere.
- A member row grants access only to a user whose confirmed `auth.users.email` equals `list_members.email`. Inserting a row for your own email on a list you do not own is blocked by INSERT (owner only).
- `list_role` returns `'owner'` only from `lists.owner_id`; a member row can never yield `'owner'`.

## What RLS outcomes look like to the data layer

- SELECT of an invisible row returns 0 rows.
- INSERT, or UPDATE that fails WITH CHECK, raises Postgres `42501`.
- UPDATE or DELETE whose USING is false affects 0 rows and raises no error.

The data layer never maps these directly to an error kind. It applies the access gate in `data-api.md`, so non-members always get `NotFound`.
