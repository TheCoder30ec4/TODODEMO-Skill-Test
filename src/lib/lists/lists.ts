import type { ListDetail, ListWithRole, Result } from "@contracts/types";
import {
  type Db,
  SELECT_WITH_ROLE,
  checkTitle,
  fail,
  gate,
  guard,
  mapPg,
  ok,
  requireUser,
  runGated,
  toList,
  toListWithRole,
  toTodo,
} from "./core";

export const createList = (db: Db, title: string): Promise<Result<ListWithRole>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const t = checkTitle(title, 200);
    if (!t.ok) return t;
    const { data, error } = await db.from("lists").insert({ title: t.data }).select().single();
    if (error) return fail(mapPg(error));
    return ok({ ...toList(data), role: "owner", memberId: null });
  });

export const listLists = (db: Db): Promise<Result<ListWithRole[]>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const { data, error } = await db
      .from("lists")
      .select(SELECT_WITH_ROLE)
      .order("created_at", { ascending: false });
    if (error) return fail(mapPg(error));
    return ok((data ?? []).map(toListWithRole));
  });

export const getList = (db: Db, listId: string): Promise<Result<ListDetail>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const g = await gate(db, listId, "viewer");
    if (!g.ok) return g;
    const { data, error } = await db
      .from("todos")
      .select()
      .eq("list_id", listId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return fail(mapPg(error));
    return ok({ list: g.data, todos: (data ?? []).map(toTodo) });
  });

export const deleteList = (db: Db, listId: string): Promise<Result<void>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const g = await gate(db, listId, "owner");
    if (!g.ok) return g;
    return runGated(db, listId, "owner", () => db.from("lists").delete().eq("id", listId).select(), () => undefined);
  });
