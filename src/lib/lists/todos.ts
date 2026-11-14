import type { Result, Todo, TodoPatch } from "@contracts/types";
import {
  type Db,
  checkTitle,
  fail,
  gate,
  guard,
  isUuid,
  listIdOfTodo,
  mapPg,
  ok,
  requireUser,
  runGated,
  toTodo,
} from "./core";

export const addTodo = (db: Db, listId: string, title: string): Promise<Result<Todo>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const t = checkTitle(title, 500);
    if (!t.ok) return t;
    const g = await gate(db, listId, "editor");
    if (!g.ok) return g;
    const last = await db
      .from("todos")
      .select("position")
      .eq("list_id", listId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) return fail(mapPg(last.error));
    const position = last.data ? (last.data.position as number) + 1 : 0;
    return runGated(
      db,
      listId,
      "editor",
      () => db.from("todos").insert({ list_id: listId, title: t.data, done: false, position }).select(),
      toTodo,
    );
  });

/** Shared body of toggle/update/delete: resolve list from todo, gate as editor, run the write. */
async function editTodo<T>(
  db: Db,
  todoId: string,
  write: () => PromiseLike<{ data: Record<string, unknown>[] | null; error: Parameters<typeof mapPg>[0] | null }>,
  map: (r: Record<string, unknown>) => T,
): Promise<Result<T>> {
  const listId = await listIdOfTodo(db, todoId);
  if (!listId.ok) return listId;
  const g = await gate(db, listId.data, "editor");
  if (!g.ok) return g;
  return runGated(db, listId.data, "editor", write, map);
}

export const toggleTodo = (db: Db, todoId: string, done: boolean): Promise<Result<Todo>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    return editTodo(db, todoId, () => db.from("todos").update({ done }).eq("id", todoId).select(), toTodo);
  });

export const updateTodo = (db: Db, todoId: string, patch: TodoPatch): Promise<Result<Todo>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const t = checkTitle(patch?.title, 500);
    if (!t.ok) return t;
    return editTodo(db, todoId, () => db.from("todos").update({ title: t.data }).eq("id", todoId).select(), toTodo);
  });

export const deleteTodo = (db: Db, todoId: string): Promise<Result<void>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    return editTodo(db, todoId, () => db.from("todos").delete().eq("id", todoId).select(), () => undefined);
  });

export const reorderTodos = (db: Db, listId: string, orderedIds: string[]): Promise<Result<void>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    if (!isUuid(listId) || !Array.isArray(orderedIds) || !orderedIds.every(isUuid)) {
      return fail({ kind: "NotFound", message: "Not found" });
    }
    // The RPC enforces the access gate itself and raises P0001 not_found/forbidden/conflict.
    const { error } = await db.rpc("reorder_todos", { p_list_id: listId, p_ids: orderedIds });
    return error ? fail(mapPg(error)) : ok(undefined);
  });
