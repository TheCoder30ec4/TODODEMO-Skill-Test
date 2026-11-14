// Shared contract types. No runtime dependencies: types only.
// DB columns are snake_case; these app types are camelCase. The data layer maps between them.
// All ids are uuid strings; all timestamps are ISO 8601 strings (timestamptz).

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
  role: AccessRole;
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
  updatedAt: string;
}

export interface ListMember {
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
  /** INSERT or UPDATE of a todo in this list. */
  onTodoUpsert?: (todo: Todo) => void;
  /** DELETE of a todo. May fire for todos of other lists (ids only); ignore unknown ids. */
  onTodoDelete?: (todoId: string) => void;
  /** INSERT or UPDATE of a member row of this list. */
  onMemberUpsert?: (member: ListMember) => void;
  /** DELETE of a member row of this list. */
  onMemberDelete?: (key: { listId: string; email: string }) => void;
  /** The current user's member row for this list was deleted. Fires after onMemberDelete. */
  onAccessRevoked?: () => void;
  /** The list itself was deleted. */
  onListDeleted?: () => void;
  /** Channel lifecycle. On SUBSCRIBED after any non-SUBSCRIBED status, refetch (see realtime.md). */
  onStatus?: (status: ChannelStatus, error?: AppError) => void;
}

export type Unsubscribe = () => void;
