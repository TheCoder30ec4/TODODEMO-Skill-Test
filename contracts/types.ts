// Shared contract types. No runtime dependencies: types only.
// Imported from src/ as `@contracts/types` (path alias, see data-api.md "Scaffold assumptions").
// DB columns are snake_case; these app types are camelCase. The data layer maps between them.
// All ids are uuid strings; all timestamps are ISO 8601 strings (timestamptz, server clock).

/** Role stored on a list_members row. */
export type Role = 'viewer' | 'editor';

/** Effective access of the current user on a list. Owner is derived from lists.owner_id, never stored as a member. */
export type AccessRole = 'owner' | Role;

export interface List {
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
}

export interface ListWithRole extends List {
  /** From computed field lists.my_role. */
  role: AccessRole;
  /** Caller's own list_members.id (from lists.my_member_id); null for the owner. */
  memberId: string | null;
}

export interface Todo {
  id: string;
  listId: string;
  title: string;
  done: boolean;
  position: number;
  /** null if the creating user was deleted. */
  createdBy: string | null;
  createdAt: string;
  /** Server-set; the only key used for merge ordering. */
  updatedAt: string;
}

export interface ListMember {
  id: string;
  listId: string;
  /** Always trimmed and lower-cased. */
  email: string;
  role: Role;
  /** null if the adding user was deleted. */
  addedBy: string | null;
  createdAt: string;
}

/** Returned by getList. todos sorted by position asc, createdAt asc, id asc. */
export interface ListDetail {
  list: ListWithRole;
  todos: Todo[];
}

export type TodoPatch = { title: string };

// ---- Errors ----

export type AppError =
  | { kind: 'Unauthenticated'; message: string }
  | { kind: 'NotFound'; message: string }
  | { kind: 'Forbidden'; message: string }
  | { kind: 'InvalidEmail'; message: string }
  | { kind: 'InvalidInput'; message: string; field?: string }
  | { kind: 'Conflict'; message: string }
  | { kind: 'Unknown'; message: string; cause?: unknown };

export type AppErrorKind = AppError['kind'];

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

// ---- Realtime ----

export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

export interface ListSubscriptionHandlers {
  /** UPDATE of this list (e.g. rename). */
  onListUpdate?: (list: List) => void;
  /** The list itself was deleted. */
  onListDeleted?: () => void;
  /** INSERT or UPDATE of a todo in this list. */
  onTodoUpsert?: (todo: Todo) => void;
  /** DELETE of a todo. Fires for todo deletes in ALL lists (id only); ignore unknown ids. */
  onTodoDelete?: (todoId: string) => void;
  /** INSERT or UPDATE of a member row of this list. */
  onMemberUpsert?: (member: ListMember) => void;
  /** DELETE of a member row. Fires for member deletes in ALL lists (id only); ignore unknown ids. */
  onMemberDelete?: (memberId: string) => void;
  /** The caller's own member row changed role. Fires after onMemberUpsert. */
  onRoleChange?: (role: Role) => void;
  /** The caller lost access (own member row deleted, or access re-check returned none). */
  onAccessRevoked?: () => void;
  /** Channel lifecycle. On SUBSCRIBED after any non-SUBSCRIBED status, refetch (see realtime.md). */
  onStatus?: (status: ChannelStatus, error?: AppError) => void;
}

export type Unsubscribe = () => void;
