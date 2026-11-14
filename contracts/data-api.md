# Data API

Implemented by `data`, called by `ui`. Types come from `contracts/types.ts`.

## Scaffold assumptions

The **scaffold owner** (whoever creates the Next.js app, as assigned by the orchestrator) must provide all of these. Contracts depend on them.

- `tsconfig.json` `compilerOptions.paths`: `"@/*": ["./src/*"]` and `"@contracts/*": ["./contracts/*"]`. `contracts/` stays at the repo root, and `src/` imports it as `import type { Todo, Result } from '@contracts/types'`. `contracts/types.ts` must be inside the TS `include`.
- `src/lib/supabase/client.ts` exports `createClient(): SupabaseClient`, the browser client (`createBrowserClient` from `@supabase/ssr`).
- `src/lib/supabase/server.ts` exports `async createClient(): Promise<SupabaseClient>`, the server client (`createServerClient` from `@supabase/ssr` with `next/headers` cookies).
- Env: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Modules

- `src/lib/lists/index.ts` (import `@/lib/lists`): list, todo and realtime functions.
- `src/lib/sharing/index.ts` (import `@/lib/sharing`): member functions.

Every function takes `db: SupabaseClient` (from `@supabase/supabase-js`) as its first argument, so it works with either client above. Every function except `subscribeToList` is `async`, returns `Promise<Result<T>>` and never throws. Exceptions map to `Unknown`.

## Input rules

- No session (`db.auth.getUser()` returns no user): `Unauthenticated`.
- Titles are `trim()`med. Empty or over the limit (list 200, todo 500 chars): `InvalidInput` (`field: 'title'`).
- Emails are `trim().toLowerCase()`d and must match `^[^@\s]+@[^@\s]+\.[^@\s]+$`, otherwise `InvalidEmail`.
- Role not `'viewer'|'editor'`: `InvalidInput` (`field: 'role'`).
- Id not a uuid: `NotFound`.

All input checks run in the data layer before any DB call. DB CHECKs are the backstop.

## Access gate (one rule for every function that targets an existing list, todo or member)

1. **Resolve the list.** List-scoped functions use their `listId`. Todo-scoped functions (`toggleTodo`, `updateTodo`, `deleteTodo`) first run `db.from('todos').select('list_id').eq('id', todoId).maybeSingle()`. RLS hides todos of lists the caller cannot read, so no row means `NotFound`.
2. **Resolve the caller's access** with `db.from('lists').select('*, my_role, my_member_id').eq('id', listId).maybeSingle()`. No row, or `my_role` NULL: **`NotFound`**. This covers both a list that does not exist and a non-member.
3. **Check the role.** If `my_role` is below the function's required role: **`Forbidden`**. Only callers who can see the list ever get `Forbidden`.
4. **Run the operation.** For update and delete, chain `.select()` and treat `data.length === 0` as 0 rows affected. A 0-row result, or Postgres `42501`, means access changed concurrently: re-run step 2 once and map again (NULL: `NotFound`; insufficient: `Forbidden`; otherwise `NotFound`, because the target row is gone).
5. **Missing target row.** A missing todo or member while the caller has the required role is `NotFound`. This applies to `changeRole` and `unshareList` on an email that is not a member.

Other Postgres errors: `23505` is `Conflict`, `23503` is `NotFound`, `23514` is `InvalidInput` (`InvalidEmail` for `list_members.email`), and `22P02` is `NotFound`. `P0001` messages `not_found`, `forbidden` and `conflict` map to `NotFound`, `Forbidden` and `Conflict`. Anything else is `Unknown` with `cause`.

Every function may also return `Unauthenticated` and `Unknown`; these are not repeated in the tables below.

## @/lib/lists

| function | params | returns | required role | errors |
|---|---|---|---|---|
| `createList` | `(db, title: string)` | `Result<ListWithRole>` (`role: 'owner'`, `memberId: null`) | any signed-in user (no gate) | `InvalidInput` |
| `listLists` | `(db)` | `Result<ListWithRole[]>`: owned and shared lists, `createdAt` desc, via `db.from('lists').select('*, my_role, my_member_id')`. RLS limits rows. | any signed-in user (no gate) | none beyond common |
| `getList` | `(db, listId: string)` | `Result<ListDetail>`. `list.role` and `list.memberId` come from the gate's step 2 row (`my_role`, `my_member_id`). Todos come from a second select. | viewer | `NotFound` |
| `deleteList` | `(db, listId: string)` | `Result<void>` | owner | `NotFound`, `Forbidden` |
| `addTodo` | `(db, listId: string, title: string)` | `Result<Todo>`. `position` = current max + 1 (0 if empty), `done: false`. | editor | `InvalidInput`, `NotFound`, `Forbidden` |
| `toggleTodo` | `(db, todoId: string, done: boolean)` | `Result<Todo>`. Sets `done` to the given value (idempotent, not a flip). | editor | `NotFound`, `Forbidden` |
| `updateTodo` | `(db, todoId: string, patch: TodoPatch)` | `Result<Todo>` | editor | `InvalidInput`, `NotFound`, `Forbidden` |
| `deleteTodo` | `(db, todoId: string)` | `Result<void>` | editor | `NotFound`, `Forbidden` |
| `reorderTodos` | `(db, listId: string, orderedIds: string[])` | `Result<void>`. Calls RPC `reorder_todos`; positions become 0..n-1 in the given order. The RPC enforces the gate itself (`P0001`). | editor | `NotFound`, `Forbidden`, `Conflict` (ids are not exactly the list's current todos: refetch and retry) |
| `subscribeToList` | `(db, listId: string, handlers: ListSubscriptionHandlers)` | `Unsubscribe` (sync, not a Result) | viewer | Not returned. Failures are reported via `handlers.onStatus('CHANNEL_ERROR' \| 'TIMED_OUT', error?)`. Lost or missing access is reported via `onAccessRevoked` (see `realtime.md`). |

"Required role" is ordered owner > editor > viewer: "editor" means owner or editor; "viewer" means any member.

## @/lib/sharing

| function | params | returns | required role | errors |
|---|---|---|---|---|
| `shareList` | `(db, listId: string, email: string, role: Role)` | `Result<ListMember>` | owner | `InvalidEmail`, `InvalidInput` (`field: 'role'`), `NotFound`, `Forbidden`, `Conflict` (email already a member of the list, or email equals the owner's own email from `db.auth.getUser()`) |
| `changeRole` | `(db, listId: string, email: string, role: Role)` | `Result<ListMember>` | owner | `InvalidEmail`, `InvalidInput` (`field: 'role'`), `NotFound` (list not visible, or no member with that email), `Forbidden` |
| `unshareList` | `(db, listId: string, email: string)` | `Result<void>` | owner | `InvalidEmail`, `NotFound` (list not visible, or no member with that email), `Forbidden` |
| `listMembers` | `(db, listId: string)` | `Result<ListMember[]>`, `createdAt` asc. The owner is not included (the owner is `List.ownerId`). Members see all collaborators' emails, by design (see `rls.md`). | viewer | `NotFound` |

`shareList` sends no email. The invitee sees the list after signing in with that email (magic link confirms it).
