import { describe, it, expect } from "vitest";
import { createList, listLists, getList, deleteList } from "@/lib/lists";
import { fakeDb, listRow, todoRow, LIST, UID, GATE } from "./helpers/fakeDb";

describe("auth (requireUser)", () => {
  it("no session (no error) -> Unauthenticated", async () => {
    const f = fakeDb({ user: null });
    expect(await listLists(f.db)).toMatchObject({ ok: false, error: { kind: "Unauthenticated" } });
    expect(f.calls).toHaveLength(0);
  });
  it("AuthSessionMissingError -> Unauthenticated", async () => {
    const f = fakeDb({ user: null, authError: { name: "AuthSessionMissingError", message: "Auth session missing!" } });
    expect(await listLists(f.db)).toMatchObject({ ok: false, error: { kind: "Unauthenticated" } });
  });
  it("other getUser error -> Unknown", async () => {
    const f = fakeDb({ user: null, authError: { name: "AuthRetryableFetchError", message: "fetch failed" } });
    expect(await listLists(f.db)).toMatchObject({ ok: false, error: { kind: "Unknown", message: "fetch failed" } });
  });
  it("getUser throwing -> Unknown, never throws", async () => {
    const f = fakeDb({ getUserThrows: true });
    expect(await listLists(f.db)).toMatchObject({ ok: false, error: { kind: "Unknown" } });
  });
});

describe("createList", () => {
  it("success: trims title, returns owner role, memberId null", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner", { title: "Groceries" }) });
    const r = await createList(f.db, "  Groceries  ");
    expect(r).toEqual({
      ok: true,
      data: { id: LIST, ownerId: UID, title: "Groceries", createdAt: "2025-01-01T00:00:00Z", role: "owner", memberId: null },
    });
    expect(f.chains("lists")).toEqual(['insert({"title":"Groceries"}).select().single()']);
  });
  it.each([["", "empty"], ["   ", "blank"]])("%j (%s) -> InvalidInput title, no DB call", async (t) => {
    const f = fakeDb();
    expect(await createList(f.db, t)).toMatchObject({ ok: false, error: { kind: "InvalidInput", field: "title" } });
    expect(f.calls).toHaveLength(0);
  });
  it("200 code points ok, 201 rejected", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") });
    expect((await createList(f.db, "a".repeat(200))).ok).toBe(true);
    expect(await createList(f.db, "a".repeat(201))).toMatchObject({ ok: false, error: { kind: "InvalidInput" } });
  });
  it("title length counts code points, not UTF-16 units", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") });
    // 200 emoji = 400 UTF-16 units but 200 code points
    expect((await createList(f.db, "😀".repeat(200))).ok).toBe(true);
    expect((await createList(f.db, "😀".repeat(201))).ok).toBe(false);
  });
  it("23514 -> InvalidInput; 42501 -> Forbidden; other -> Unknown with cause", async () => {
    const f = fakeDb().queue("lists", { error: { code: "23514" } }, { error: { code: "42501" } }, { error: { code: "XX", message: "boom" } });
    expect(await createList(f.db, "x")).toMatchObject({ error: { kind: "InvalidInput" } });
    expect(await createList(f.db, "x")).toMatchObject({ error: { kind: "Forbidden" } });
    expect(await createList(f.db, "x")).toMatchObject({ error: { kind: "Unknown", message: "boom", cause: { code: "XX" } } });
  });
});

describe("listLists", () => {
  it("maps rows with role, orders by created_at desc", async () => {
    const f = fakeDb().queue("lists", { data: [listRow("owner"), listRow("editor")] });
    const r = await listLists(f.db);
    expect(r.ok && r.data.map((l) => [l.role, l.memberId])).toEqual([["owner", null], ["editor", expect.any(String)]]);
    expect(f.chains("lists")).toEqual(['select("*, my_role, my_member_id").order("created_at",{"ascending":false})']);
  });
  it("null data -> empty array; DB error -> Unknown", async () => {
    const f = fakeDb().queue("lists", { data: null }, { error: { code: "XX", message: "m" } });
    expect(await listLists(f.db)).toEqual({ ok: true, data: [] });
    expect(await listLists(f.db)).toMatchObject({ error: { kind: "Unknown" } });
  });
});

describe("getList", () => {
  it("success: list from gate row + todos", async () => {
    const f = fakeDb().queue("lists", { data: listRow("viewer") }).queue("todos", { data: [todoRow()] });
    const r = await getList(f.db, LIST);
    expect(r.ok && r.data.list.role).toBe("viewer");
    expect(r.ok && r.data.todos[0]).toMatchObject({ id: expect.any(String), listId: LIST, done: false, updatedAt: expect.any(String) });
    expect(f.chains("lists")).toEqual([GATE]);
    // todos scoped to THIS list, sorted position, created_at, id
    expect(f.chains("todos")).toEqual([
      `select().eq("list_id","${LIST}").order("position",{"ascending":true}).order("created_at",{"ascending":true}).order("id",{"ascending":true})`,
    ]);
  });
  it("non-uuid -> NotFound without DB call", async () => {
    const f = fakeDb();
    expect(await getList(f.db, "nope")).toMatchObject({ error: { kind: "NotFound" } });
    expect(f.calls).toHaveLength(0);
  });
  it("missing row -> NotFound; my_role NULL (non-member) -> NotFound, never Forbidden", async () => {
    const f = fakeDb().queue("lists", { data: null }, { data: listRow(null) });
    expect(await getList(f.db, LIST)).toMatchObject({ error: { kind: "NotFound" } });
    expect(await getList(f.db, LIST)).toMatchObject({ error: { kind: "NotFound" } });
  });
  it("todos query error mapped", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("todos", { error: { code: "XX" } });
    expect(await getList(f.db, LIST)).toMatchObject({ error: { kind: "Unknown" } });
  });
});

describe("deleteList", () => {
  it("owner success", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: [listRow("owner")] });
    expect(await deleteList(f.db, LIST)).toEqual({ ok: true, data: undefined });
    expect(f.chains("lists")).toEqual([GATE, `delete().eq("id","${LIST}").select()`]);
  });
  it("editor/viewer -> Forbidden (list visible, role too low), no delete issued", async () => {
    for (const role of ["editor", "viewer"]) {
      const f = fakeDb().queue("lists", { data: listRow(role) });
      expect(await deleteList(f.db, LIST)).toMatchObject({ error: { kind: "Forbidden" } });
      expect(f.calls).toHaveLength(1);
    }
  });
  it("non-member / missing -> NotFound", async () => {
    const f = fakeDb().queue("lists", { data: null });
    expect(await deleteList(f.db, LIST)).toMatchObject({ error: { kind: "NotFound" } });
  });
  it("0 rows then re-check: access lost -> NotFound", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: [] }, { data: null });
    expect(await deleteList(f.db, LIST)).toMatchObject({ error: { kind: "NotFound" } });
    expect(f.chains("lists")).toEqual([GATE, `delete().eq("id","${LIST}").select()`, GATE]);
  });
  it("0 rows then re-check: role downgraded -> Forbidden", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: [] }, { data: listRow("editor") });
    expect(await deleteList(f.db, LIST)).toMatchObject({ error: { kind: "Forbidden" } });
  });
  it("0 rows then re-check: still owner (row gone) -> NotFound, re-checks only once", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { data: [] }, { data: listRow("owner") });
    expect(await deleteList(f.db, LIST)).toMatchObject({ error: { kind: "NotFound" } });
    expect(f.calls).toHaveLength(3);
  });
  it("42501 re-checks once like 0 rows", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }, { error: { code: "42501" } }, { data: listRow("viewer") });
    expect(await deleteList(f.db, LIST)).toMatchObject({ error: { kind: "Forbidden" } });
    expect(f.calls).toHaveLength(3);
  });
});
