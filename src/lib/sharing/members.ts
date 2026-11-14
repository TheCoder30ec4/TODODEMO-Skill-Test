import type { ListMember, Result, Role } from "@contracts/types";
import {
  type Db,
  checkEmail,
  checkRole,
  fail,
  gate,
  guard,
  mapPg,
  ok,
  requireUser,
  runGated,
  toMember,
} from "@/lib/lists/core";

export const shareList = (db: Db, listId: string, email: string, role: Role): Promise<Result<ListMember>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const e = checkEmail(email);
    if (!e.ok) return e;
    const r = checkRole(role);
    if (!r.ok) return r;
    const g = await gate(db, listId, "owner");
    if (!g.ok) return g;
    if (u.data.email?.trim().toLowerCase() === e.data) {
      return fail({ kind: "Conflict", message: "You already own this list" });
    }
    return runGated(
      db,
      listId,
      "owner",
      () => db.from("list_members").insert({ list_id: listId, email: e.data, role: r.data }).select(),
      toMember,
    );
  });

export const changeRole = (db: Db, listId: string, email: string, role: Role): Promise<Result<ListMember>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const e = checkEmail(email);
    if (!e.ok) return e;
    const r = checkRole(role);
    if (!r.ok) return r;
    const g = await gate(db, listId, "owner");
    if (!g.ok) return g;
    return runGated(
      db,
      listId,
      "owner",
      () => db.from("list_members").update({ role: r.data }).eq("list_id", listId).eq("email", e.data).select(),
      toMember,
    );
  });

export const unshareList = (db: Db, listId: string, email: string): Promise<Result<void>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const e = checkEmail(email);
    if (!e.ok) return e;
    const g = await gate(db, listId, "owner");
    if (!g.ok) return g;
    return runGated(
      db,
      listId,
      "owner",
      () => db.from("list_members").delete().eq("list_id", listId).eq("email", e.data).select(),
      () => undefined,
    );
  });

export const listMembers = (db: Db, listId: string): Promise<Result<ListMember[]>> =>
  guard(async () => {
    const u = await requireUser(db);
    if (!u.ok) return u;
    const g = await gate(db, listId, "viewer");
    if (!g.ok) return g;
    const { data, error } = await db
      .from("list_members")
      .select()
      .eq("list_id", listId)
      .order("created_at", { ascending: true });
    if (error) return fail(mapPg(error));
    return ok((data ?? []).map(toMember));
  });
