# Realtime

Supabase Realtime `postgres_changes`. Tables in publication `supabase_realtime`: `lists`, `todos`, `list_members` (data-model.md). Realtime enforces the SELECT policies (rls.md) for INSERT/UPDATE events, so a user only receives rows they may read. DELETE events cannot be filtered or RLS-checked by Realtime; their `old` record carries only the primary key.

## Channel

One channel per open list view: name `list:{listId}`. Created and owned by `subscribeToList` (`@/lib/lists`); the UI never builds channels itself. supabase-js passes the session JWT automatically.

## Subscriptions on `list:{listId}`

| # | table | event | filter | mapped to handler |
|---|---|---|---|---|
| 1 | `todos` | `INSERT` | `list_id=eq.{listId}` | `onTodoUpsert(Todo)` |
| 2 | `todos` | `UPDATE` | `list_id=eq.{listId}` | `onTodoUpsert(Todo)` |
| 3 | `todos` | `DELETE` | none (not filterable) | `onTodoDelete(old.id)` |
| 4 | `list_members` | `INSERT` | `list_id=eq.{listId}` | `onMemberUpsert(ListMember)` |
| 5 | `list_members` | `UPDATE` | `list_id=eq.{listId}` | `onMemberUpsert(ListMember)` |
| 6 | `list_members` | `DELETE` | none | only if `old.list_id === listId`: `onMemberDelete({listId, email: old.email})`, then `onAccessRevoked()` if `old.email` equals the session email (lower-cased) |
| 7 | `lists` | `DELETE` | none | only if `old.id === listId`: `onListDeleted()` |

Channel status from `.subscribe(cb)` is forwarded to `onStatus`.

## Payload shapes

Raw (supabase-js `RealtimePostgresChangesPayload`): `{ schema: 'public', table, eventType: 'INSERT'|'UPDATE'|'DELETE', commit_timestamp, new, old, errors }`.

- INSERT/UPDATE: `new` is the full snake_case row (data-model.md columns); `old` is `{}` or PK only.
- DELETE: `new` is `{}`; `old` is the PK: todos `{ id }`, list_members `{ list_id, email }`, lists `{ id }`.

`subscribeToList` maps `new` to the camelCase `Todo` / `ListMember` from `types.ts` before calling handlers. Handlers never see raw payloads.

## Merge rules (UI)

State per list view: `todos: Map<id, Todo>`, `members: Map<email, ListMember>`, `deleted: Set<todoId>` (tombstones for this view's lifetime).

1. Order: subscribe first, then on the first `SUBSCRIBED` call `getList` and `listMembers`. Events arriving before the snapshot are applied with the rules below, so order does not matter.
2. Snapshot merge: for each snapshot todo, apply rule 3 (do not blindly overwrite newer event data); drop ids in `deleted`.
3. Todo upsert: ignore if id in `deleted`. If absent, insert. If present, replace only when `incoming.updatedAt >= local.updatedAt`.
4. Todo delete: remove from map, add id to `deleted`. Unknown ids are ignored (they belong to other lists).
5. Render sorted by `position` asc, then `createdAt` asc, then `id` asc.
6. Members: upsert/delete by `email`. No timestamps needed (only `role` changes).
7. Own writes: apply optimistically, then call the data API. On `ok`, merge the returned row via rule 3. On error, revert that change and show the error. The echoed Realtime event is harmless under rule 3.
8. Reorder: optimistic reorder locally; on `Conflict`, refetch `getList` and drop the local order.
9. Reconnect: on `SUBSCRIBED` after any `TIMED_OUT` / `CHANNEL_ERROR` / `CLOSED`, refetch `getList` + `listMembers` and merge per rule 2 (missed events are not replayed).
10. `onAccessRevoked` or `onListDeleted`: unsubscribe and navigate to the lists index with a notice.

## Cleanup

- `Unsubscribe` calls `db.removeChannel(channel)`. It is idempotent (safe to call twice).
- Call it in the `useEffect` cleanup of the component that subscribed; re-subscribe when `listId` changes.
- At most one channel per `listId` per mounted view; do not subscribe from server components.
- On sign-out call `db.removeAllChannels()` before `auth.signOut()`.
