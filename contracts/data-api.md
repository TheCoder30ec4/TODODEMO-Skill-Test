# Data API

Implemented by `data`, called by `ui`. Types from `contracts/types.ts`.

## Modules

- `src/lib/lists/index.ts` (import `@/lib/lists`): list, todo and realtime functions.
- `src/lib/sharing/index.ts` (import `@/lib/sharing`): member functions.

Every function takes `db: SupabaseClient` (from `@supabase/supabase-js`) first, so it works with both the browser and the server (cookie) client. Every function except `subscribeToList` is `async` and returns `Promise<Result<T>>`; it never throws (exceptions map to `Unknown`).

## Common rules (apply to every function)

- No session (`auth.getUser()` has no user) -> `Unauthenticated`.
- Titles are `trim()`med; empty or over limit (list 200, todo 500 chars) -> `InvalidInput` (`field: 'title'`), validated in the data layer before any DB call (DB CHECKs are the backstop).
- Emails are `trim().toLowerCase()`d; must match `^[^@\s]+@[^@\s]+\.[^@\s]+$` -> else `InvalidEmail`.
- Ids that are not uuids -> `NotFound`.
- Error mapping: 0 rows on read -> `NotFound`. Mutation affecting 0 rows -> `Forbidden` if the caller can see the list (`list_role` not NULL), else `NotFound`. Postgres `42501` -> `Forbidden`; `23505` -> `Conflict`; `23503` -> `NotFound`; `23514` -> `InvalidInput` (or `InvalidEmail` for `list_members.email`); `P0001` messages `not_found`/`forbidden`/`conflict` -> `NotFound`/`Forbidden`/`Conflict`; anything else -> `Unknown` with `cause`.
- Non-members always get `NotFound`, never `Forbidden` (do not leak existence).
- Every function may also return `Unauthenticated` and `Unknown`; these are not repeated below.

## @/lib/lists

| function | params | returns | callers | errors |
|---|---|---|---|---|
| `createList` | `(db, title: string)` | `Result<ListWithRole>` (`role: 'owner'`) | any signed-in user | `InvalidInput` |
| `listLists` | `(db)` | `Result<ListWithRole[]>`: owned + shared, `createdAt` desc | any signed-in user | none beyond common |
| `getList` | `(db, listId: string)` | `Result<ListDetail>` | owner, editor, viewer | `NotFound` |
| `deleteList` | `(db, listId: string)` | `Result<void>` | owner | `Forbidden` (editor/viewer), `NotFound` |
| `addTodo` | `(db, listId: string, title: string)` | `Result<Todo>`; `position` = current max + 1 (0 if empty), `done: false` | owner, editor | `InvalidInput`, `Forbidden` (viewer), `NotFound` |
| `toggleTodo` | `(db, todoId: string, done: boolean)` | `Result<Todo>`; sets `done` to the given value (idempotent, not a flip) | owner, editor | `Forbidden` (viewer), `NotFound` |
| `updateTodo` | `(db, todoId: string, patch: TodoPatch)` | `Result<Todo>` | owner, editor | `InvalidInput`, `Forbidden` (viewer), `NotFound` |
| `deleteTodo` | `(db, todoId: string)` | `Result<void>` | owner, editor | `Forbidden` (viewer), `NotFound` |
| `reorderTodos` | `(db, listId: string, orderedIds: string[])` | `Result<void>`; calls RPC `reorder_todos`, positions become 0..n-1 in given order | owner, editor | `Forbidden` (viewer), `NotFound`, `Conflict` (ids are not exactly the list's current todos: refetch and retry) |
| `subscribeToList` | `(db, listId: string, handlers: ListSubscriptionHandlers)` | `Unsubscribe` (sync, not a Result) | owner, editor, viewer | not returned; reported via `handlers.onStatus('CHANNEL_ERROR' \| 'TIMED_OUT', error?)`. A non-member subscribes successfully but receives no INSERT/UPDATE events. See `realtime.md`. |

`listLists` role derivation: `owner` if `ownerId` = current user id, else the role of the caller's own `list_members` row (email = session email).

## @/lib/sharing

| function | params | returns | callers | errors |
|---|---|---|---|---|
| `shareList` | `(db, listId: string, email: string, role: Role)` | `Result<ListMember>` | owner | `InvalidEmail`, `InvalidInput` (`field: 'role'`, role not viewer/editor), `Conflict` (email already a member, or email is the owner's own session email), `Forbidden` (editor/viewer), `NotFound` |
| `changeRole` | `(db, listId: string, email: string, role: Role)` | `Result<ListMember>` | owner | `InvalidEmail`, `InvalidInput` (`field: 'role'`), `Forbidden` (editor/viewer), `NotFound` (list invisible or no such member) |
| `unshareList` | `(db, listId: string, email: string)` | `Result<void>` | owner | `InvalidEmail`, `Forbidden` (editor/viewer), `NotFound` (list invisible or no such member) |
| `listMembers` | `(db, listId: string)` | `Result<ListMember[]>`, `createdAt` asc; owner is not included (owner is `List.ownerId`) | owner, editor, viewer | `NotFound` |

No email is sent by `shareList`; the invitee sees the list after signing in with that email.
