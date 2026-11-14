import { describe, it, expect } from "vitest";
import { shareList, changeRole, unshareList, listMembers } from "@/lib/sharing";
import { fakeDb, listRow, memberRow, LIST } from "./helpers/fakeDb";

describe("shareList", () => {
  it("success: email trimmed + lower-cased, role passed, mapped member", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("list_members", { data: [memberRow({ email: "bob@x.co", role: "editor" })] });
    const r = await shareList(f.db, LIST, "  Bob@X.CO ", "editor");
    expect(r).toMatchObject({ ok: true, data: { email: "bob@x.co", role: "editor", listId: LIST, addedBy: expect.any(String) } });
    expect(f.on("list_members")[0].ops[0]).toEqual(["insert", [{ list_id: LIST, email: "bob@x.co", role: "editor" }]]);
  });
  it.each(["", "nope", "a@b", "a b@c.co", "@x.co", "a@.co "])("invalid email %j -> InvalidEmail before any DB call", async (e) => {
    const f = fakeDb();
    expect(await shareList(f.db, LIST, e, "viewer")).toMatchObject({ error: { kind: "InvalidEmail" } });
    expect(f.calls).toHaveLength(0);
  });
  it("invalid role -> InvalidInput role (also owner is not assignable)", async () => {
    const f = fakeDb();
    for (const role of ["owner", "admin", "", undefined]) {
      expect(await shareList(f.db, LIST, "a@b.co", role as never)).toMatchObject({ error: { kind: "InvalidInput", field: "role" } });
    }
    expect(f.calls).toHaveLength(0);
  });
  it("non-member -> NotFound; editor -> Forbidden; bad id -> NotFound", async () => {
    const f = fakeDb().queue("lists", { data: listRow(null) }, { data: listRow("editor") });
    expect(await shareList(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "NotFound" } });
    expect(await shareList(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "Forbidden" } });
    expect(await shareList(f.db, "bad", "a@b.co", "viewer")).toMatchObject({ error: { kind: "NotFound" } });
  });
  it("owner's own email (case-insensitive) -> Conflict, no insert", async () => {
    const f = fakeDb({ user: { id: "u", email: "Owner@X.co" } }).queue("lists", { data: listRow("owner") });
    expect(await shareList(f.db, LIST, "OWNER@x.co", "viewer")).toMatchObject({ error: { kind: "Conflict" } });
    expect(f.on("list_members")).toHaveLength(0);
  });
  it("unique violation 23505 -> Conflict", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("list_members", { error: { code: "23505" } });
    expect(await shareList(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "Conflict" } });
  });
  it("23514 on list_members_email -> InvalidEmail", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("list_members", { error: { code: "23514", message: 'violates check constraint "list_members_email_format"' } });
    expect(await shareList(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "InvalidEmail" } });
  });
  it("42501 re-checks once (owner lost) -> NotFound / Forbidden", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: null }).queue("list_members", { error: { code: "42501" } });
    expect(await shareList(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "NotFound" } });
    const g = fakeDb().queue("lists", { data: listRow("owner") }, { data: listRow("viewer") }).queue("list_members", { error: { code: "42501" } });
    expect(await shareList(g.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "Forbidden" } });
  });
  it("Unauthenticated / Unknown", async () => {
    expect(await shareList(fakeDb({ user: null }).db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "Unauthenticated" } });
    expect(await shareList(fakeDb({ getUserThrows: true }).db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "Unknown" } });
  });
});

describe("changeRole", () => {
  it("success updates role by list_id + lower-cased email", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("list_members", { data: [memberRow({ role: "editor" })] });
    expect(await changeRole(f.db, LIST, " A@B.co", "editor")).toMatchObject({ ok: true, data: { role: "editor" } });
    const ops = f.on("list_members")[0].ops;
    expect(ops[0]).toEqual(["update", [{ role: "editor" }]]);
    expect(ops).toContainEqual(["eq", ["email", "a@b.co"]]);
    expect(ops).toContainEqual(["eq", ["list_id", LIST]]);
  });
  it("validation: InvalidEmail, role InvalidInput", async () => {
    const f = fakeDb();
    expect(await changeRole(f.db, LIST, "x", "viewer")).toMatchObject({ error: { kind: "InvalidEmail" } });
    expect(await changeRole(f.db, LIST, "a@b.co", "owner" as never)).toMatchObject({ error: { kind: "InvalidInput", field: "role" } });
  });
  it("email not a member (0 rows, still owner) -> NotFound; list invisible -> NotFound; editor -> Forbidden", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: listRow("owner") }, { data: null }, { data: listRow("editor") }).queue("list_members", { data: [] });
    expect(await changeRole(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "NotFound" } });
    expect(await changeRole(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "NotFound" } });
    expect(await changeRole(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "Forbidden" } });
  });
  it("0 rows re-check with role downgraded -> Forbidden", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: listRow("editor") }).queue("list_members", { data: [] });
    expect(await changeRole(f.db, LIST, "a@b.co", "viewer")).toMatchObject({ error: { kind: "Forbidden" } });
  });
});

describe("unshareList", () => {
  it("success", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("list_members", { data: [memberRow()] });
    expect(await unshareList(f.db, LIST, "A@b.co")).toEqual({ ok: true, data: undefined });
    expect(f.on("list_members")[0].ops).toContainEqual(["eq", ["email", "a@b.co"]]);
  });
  it("InvalidEmail; non-member email -> NotFound; non-owner -> Forbidden; invisible -> NotFound", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: listRow("owner") }, { data: listRow("viewer") }, { data: null }).queue("list_members", { data: [] });
    expect(await unshareList(f.db, LIST, "bad")).toMatchObject({ error: { kind: "InvalidEmail" } });
    expect(await unshareList(f.db, LIST, "a@b.co")).toMatchObject({ error: { kind: "NotFound" } });
    expect(await unshareList(f.db, LIST, "a@b.co")).toMatchObject({ error: { kind: "Forbidden" } });
    expect(await unshareList(f.db, LIST, "a@b.co")).toMatchObject({ error: { kind: "NotFound" } });
  });
});

describe("listMembers", () => {
  it("success maps rows, ordered by created_at asc", async () => {
    const f = fakeDb().queue("lists", { data: listRow("viewer") }).queue("list_members", { data: [memberRow(), memberRow({ id: "m2" })] });
    const r = await listMembers(f.db, LIST);
    expect(r.ok && r.data).toHaveLength(2);
    expect(f.on("list_members")[0].ops).toContainEqual(["order", ["created_at", { ascending: true }]]);
  });
  it("non-member / bad id -> NotFound; query error -> Unknown", async () => {
    const f = fakeDb().queue("lists", { data: listRow(null) }, { data: listRow("owner") }).queue("list_members", { error: { code: "XX" } });
    expect(await listMembers(f.db, LIST)).toMatchObject({ error: { kind: "NotFound" } });
    expect(await listMembers(f.db, LIST)).toMatchObject({ error: { kind: "Unknown" } });
    expect(await listMembers(f.db, "x")).toMatchObject({ error: { kind: "NotFound" } });
  });
});
