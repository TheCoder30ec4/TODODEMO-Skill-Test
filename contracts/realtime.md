# Realtime

Supabase Realtime `postgres_changes`. The tables in publication `supabase_realtime` are `lists`, `todos` and `list_members` (data-model.md). Realtime enforces the SELECT policies (rls.md) on INSERT and UPDATE events, so a user only receives rows they may read. DELETE events are not filtered and not RLS-checked. Their `old` record is the PK `{ id }` only, so every subscribed client receives the id of **every** delete on these tables, across all lists. Because every PK is a random uuid, this leaks no emails or titles. (Both behaviours are unverified; see "Assumptions to verify".)

## Channel

There is one channel per open list view, named `list:{listId}`. `subscribeToList` (`@/lib/lists`) creates and owns it; the UI never builds channels itself. supabase-js passes the session JWT automatically.

## Subscriptions on `list:{listId}`

| # | table | event | filter | mapped to handler |
|---|---|---|---|---|
| 1 | `lists` | `UPDATE` | `id=eq.{listId}` | `onListUpdate(List)` |
| 2 | `lists` | `DELETE` | none (not filterable) | only if `old.id === listId`: `onListDeleted()` |
| 3 | `todos` | `INSERT` | `list_id=eq.{listId}` | `onTodoUpsert(Todo)` |
| 4 | `todos` | `UPDATE` | `list_id=eq.{listId}` | `onTodoUpsert(Todo)` |
| 5 | `todos` | `DELETE` | none | `onTodoDelete(old.id)` (any list; the UI ignores unknown ids) |
| 6 | `list_members` | `INSERT` | `list_id=eq.{listId}` | `onMemberUpsert(ListMember)` |
| 7 | `list_members` | `UPDATE` | `list_id=eq.{listId}` | `onMemberUpsert(ListMember)`; then, if `new.id === ownMemberId`, `onRoleChange(new.role)` |
| 8 | `list_members` | `DELETE` | none | `onMemberDelete(old.id)` (any list; the UI ignores unknown ids); then, if `old.id === ownMemberId`, `onAccessRevoked()` |

**Own member id.** On every `SUBSCRIBED` status, including the first and each reconnect, `subscribeToList` runs `db.from('lists').select('my_role, my_member_id').eq('id', listId).maybeSingle()`. It stores `ownMemberId = my_member_id`, which is NULL for the owner. If no row comes back or `my_role` is NULL, it calls `onAccessRevoked()`. Emails are never compared client-side.

Channel status from `.subscribe(cb)` is forwarded to `onStatus`.

## Payload shapes

The raw payload (supabase-js `RealtimePostgresChangesPayload`) is `{ schema: 'public', table, eventType: 'INSERT'|'UPDATE'|'DELETE', commit_timestamp, new, old, errors }`.

- INSERT and UPDATE: `new` is the full snake_case row (data-model.md columns). `old` is `{}` or `{ id }`.
- DELETE: `new` is `{}` and `old` is `{ id }` for all three tables.

`subscribeToList` maps `new` to the camelCase `List`, `Todo` or `ListMember` from `types.ts` before calling handlers. Handlers never see raw payloads.

## Merge rules (UI)

State per list view: `list: ListWithRole`, `todos: Map<id, Todo>`, `members: Map<id, ListMember>`, and `deleted: Set<todoId>` (tombstones kept for the view's lifetime).

1. **Order.** Subscribe first. Then, on the first `SUBSCRIBED`, call `getList` and `listMembers`. Events that arrive before the snapshot are applied with the rules below, so arrival order does not matter.
2. **Snapshot merge.** Apply rule 3 to each snapshot todo; never blindly overwrite newer event data. Drop ids that are in `deleted`.
3. **Todo upsert.** Ignore it if the id is in `deleted`. If the id is absent, insert it. If present, replace only when `incoming.updatedAt >= local.updatedAt`. `updatedAt` is always the **server** value from a row or event. The client clock is never used; an optimistic local edit keeps the last server `updatedAt`.
4. **Todo delete.** Remove the id from the map and add it to `deleted`. Ignore unknown ids, which belong to other lists.
5. **Render order.** Sort by `position` asc, then `createdAt` asc, then `id` asc.
6. **Members.** Upsert and delete by `id`; there is no timestamp ordering, since only `role` changes. `onRoleChange(role)` sets `list.role = role` and immediately enables or disables edit controls. After a downgrade to viewer, in-flight edits that fail with `Forbidden` are reverted under rule 7.
7. **Own writes.** Apply the change optimistically, then call the data API. On `ok`, merge the returned row via rule 3. On error, revert the change and show the error. The echoed Realtime event is harmless under rule 3.
8. **Reorder.** Reorder optimistically. On `Conflict`, refetch `getList` and drop the local order.
9. **Reconnect.** On `SUBSCRIBED` after any `TIMED_OUT`, `CHANNEL_ERROR` or `CLOSED`, refetch `getList` and `listMembers` and merge per rule 2. Missed events are not replayed.
10. **List update.** `onListUpdate(list)` replaces `title`; `role` and `memberId` are kept.
11. **Lost access.** On `onAccessRevoked` or `onListDeleted`, unsubscribe and navigate to the lists index with a notice.

## Cleanup

- `Unsubscribe` calls `db.removeChannel(channel)`. It is idempotent and safe to call twice.
- Call it in the `useEffect` cleanup of the component that subscribed, and re-subscribe when `listId` changes.
- Keep at most one channel per `listId` per mounted view. Do not subscribe from server components.
- On sign-out, call `db.removeAllChannels()` before `auth.signOut()`.

## Assumptions to verify

These are **UNVERIFIED**. They come from memory of Supabase behaviour and were not tested while writing the contracts. db and data must confirm them before relying on them. If one is false, report it, and the contract gets amended.

| # | assumption | depends on it |
|---|---|---|
| A1 | `postgres_changes` DELETE events cannot be filtered and are not RLS-checked; `old` carries the PK only. | rows 2, 5 and 8 above; the id-only PK design |
| A2 | When Realtime evaluates the SELECT policies, `auth.uid()` inside the DEFINER function `public.list_role` sees the subscriber's JWT claims, so INSERT and UPDATE events reach members only. | every INSERT and UPDATE subscription |

Verification tests:

- **db (SQL, local Supabase).** In a transaction, `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true);` for each of owner A, editor B (a member row with B's confirmed email), viewer V, non-member C, and user U, whose `auth.users.email` matches a member row but whose `email_confirmed_at` is NULL. Assert `public.list_role(list)` returns `owner`, `editor`, `viewer`, NULL and NULL. Assert that C and U select 0 rows from all three tables. Assert that a B insert into `list_members` raises `42501`.
- **data (two or three real clients against local Supabase).** A creates a list and shares it with B as editor. B and C (non-member) each call `subscribeToList` and wait for `SUBSCRIBED`.
  1. A calls `addTodo`. Within 5 s, B's `onTodoUpsert` fires with that todo's id (A2 holds for a non-owner). C receives no `onTodoUpsert` within 5 s, and C's re-check fires `onAccessRevoked` (A2 holds for a non-member).
  2. A calls `deleteTodo`. Record whether C's `onTodoDelete` fires with only the id. Firing confirms A1; not firing means DELETEs are filtered, which is safe, but report it.
  3. A calls `unshareList(B)`. B's `onAccessRevoked` fires.
