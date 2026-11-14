// Pure merge rules from contracts/realtime.md (no React). State is a Map<id, Todo> plus a
// tombstone Set<id> of deleted todo ids. Every function returns the SAME map when nothing
// changed, so React can skip re-rendering. Only `markDeleted` mutates (the tombstone set).
import type { Todo } from "@contracts/types";

type Todos = Map<string, Todo>;

/** Compare server timestamps as instants; fall back to string order if either is unparsable. */
export function cmpUpdated(a: string, b: string): number {
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a < b ? -1 : a > b ? 1 : 0;
}

/** Rule 3: insert, or replace only if incoming.updatedAt >= local.updatedAt. Tombstoned ids are ignored. */
export function applyUpsert(todos: Todos, deleted: Set<string>, t: Todo): Todos {
  if (deleted.has(t.id)) return todos;
  const cur = todos.get(t.id);
  if (cur && cmpUpdated(t.updatedAt, cur.updatedAt) < 0) return todos;
  return new Map(todos).set(t.id, t);
}

/** Rule 4: tombstone the id (mutates `deleted`) and remove it if present. Unknown ids are still tombstoned harmlessly. */
export function applyDelete(todos: Todos, deleted: Set<string>, id: string): Todos {
  deleted.add(id);
  if (!todos.has(id)) return todos;
  const n = new Map(todos);
  n.delete(id);
  return n;
}

/**
 * Rule 7 rollback of a failed optimistic edit: restore `prev` only if the map still holds the
 * exact `optimistic` object we put there (a newer server update replaced it otherwise) and the id is not tombstoned.
 */
export function rollback(todos: Todos, deleted: Set<string>, prev: Todo, optimistic: Todo): Todos {
  if (deleted.has(prev.id) || todos.get(prev.id) !== optimistic) return todos;
  return new Map(todos).set(prev.id, prev);
}

/** Rollback of a failed optimistic delete: re-add `t` only if not tombstoned and not already present. */
export function restoreDeleted(todos: Todos, deleted: Set<string>, t: Todo): Todos {
  if (deleted.has(t.id) || todos.has(t.id)) return todos;
  return new Map(todos).set(t.id, t);
}

/**
 * Rule 9 reconnect: merge the snapshot via rule 3, then drop only ids that existed BEFORE the
 * refetch started (`before`) and are missing from the snapshot. Todos that arrived during the
 * refetch (including the user's own) are never dropped.
 */
export function reconcile(todos: Todos, deleted: Set<string>, snapshot: Todo[], before: Set<string>): Todos {
  let m = todos;
  for (const t of snapshot) m = applyUpsert(m, deleted, t);
  const inSnap = new Set(snapshot.map((t) => t.id));
  const gone = [...before].filter((id) => !inSnap.has(id) && m.has(id));
  if (gone.length === 0) return m;
  const n = new Map(m);
  gone.forEach((id) => n.delete(id));
  return n;
}
