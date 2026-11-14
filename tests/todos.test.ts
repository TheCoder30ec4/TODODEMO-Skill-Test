import { describe, it, expect } from "vitest";
import { addTodo, toggleTodo, updateTodo, deleteTodo, reorderTodos } from "@/lib/lists";
import { fakeDb, listRow, todoRow, todoObj, LIST, TODO, OTHER, GATE, TODO_LOOKUP } from "./helpers/fakeDb";

describe("addTodo", () => {
  it("position = max + 1, done false, trimmed title", async () => {
    const f = fakeDb()
      .queue("lists", { data: listRow("editor") })
      .queue("todos", { data: { position: 4 } }, { data: [todoRow({ position: 5, title: "x" })] });
    const r = await addTodo(f.db, LIST, "  x ");
    expect(r).toEqual({ ok: true, data: todoObj({ position: 5, title: "x" }) });
    expect(f.chains("lists")).toEqual([GATE]);
    expect(f.chains("todos")).toEqual([
      `select("position").eq("list_id","${LIST}").order("position",{"ascending":false}).limit(1).maybeSingle()`,
      `insert({"list_id":"${LIST}","title":"x","done":false,"position":5}).select()`,
    ]);
  });
  it("empty list -> position 0", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("todos", { data: null }, { data: [todoRow()] });
    await addTodo(f.db, LIST, "x");
    expect(f.chains("todos")[1]).toContain('"position":0');
  });
  it("title validation (empty, 501 code points; 500 emoji ok)", async () => {
    const f = fakeDb();
    expect(await addTodo(f.db, LIST, " ")).toMatchObject({ error: { kind: "InvalidInput", field: "title" } });
    expect(await addTodo(f.db, LIST, "a".repeat(501))).toMatchObject({ error: { kind: "InvalidInput" } });
    expect(f.calls).toHaveLength(0);
    f.queue("lists", { data: listRow("owner") }).queue("todos", { data: null }, { data: [todoRow()] });
    expect((await addTodo(f.db, LIST, "😀".repeat(500))).ok).toBe(true);
  });
  it("viewer -> Forbidden; non-member -> NotFound; bad id -> NotFound", async () => {
    const f = fakeDb().queue("lists", { data: listRow("viewer") }, { data: listRow(null) });
    expect(await addTodo(f.db, LIST, "x")).toMatchObject({ error: { kind: "Forbidden" } });
    expect(await addTodo(f.db, LIST, "x")).toMatchObject({ error: { kind: "NotFound" } });
    expect(await addTodo(f.db, "bad", "x")).toMatchObject({ error: { kind: "NotFound" } });
  });
  it("insert 42501 (role dropped concurrently) re-checks once -> Forbidden", async () => {
    const f = fakeDb()
      .queue("lists", { data: listRow("editor") }, { data: listRow("viewer") })
      .queue("todos", { data: null }, { error: { code: "42501" } });
    expect(await addTodo(f.db, LIST, "x")).toMatchObject({ error: { kind: "Forbidden" } });
    expect(f.on("lists")).toHaveLength(2);
  });
  it("max-position query error mapped", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("todos", { error: { code: "XX" } });
    expect(await addTodo(f.db, LIST, "x")).toMatchObject({ error: { kind: "Unknown" } });
  });
});

// Shared behaviour of the three todoId functions.
// The exact write chain each must issue: scoped to THIS todo by id, and returning rows via .select().
const todoFns: [string, (db: ReturnType<typeof fakeDb>["db"]) => Promise<{ ok: boolean; error?: { kind: string } }>, string][] = [
  ["toggleTodo", (db) => toggleTodo(db, TODO, true), `update({"done":true}).eq("id","${TODO}").select()`],
  ["updateTodo", (db) => updateTodo(db, TODO, { title: "n" }), `update({"title":"n"}).eq("id","${TODO}").select()`],
  ["deleteTodo", (db) => deleteTodo(db, TODO), `delete().eq("id","${TODO}").select()`],
];
describe.each(todoFns)("%s access gate", (_n, call, write) => {
  it("resolves list_id from todos first, then gates on lists", async () => {
    const f = fakeDb()
      .queue("todos", { data: { list_id: LIST } }, { data: [todoRow()] })
      .queue("lists", { data: listRow("editor") });
    expect((await call(f.db)).ok).toBe(true);
    expect(f.calls.map((c) => c.table)).toEqual(["todos", "lists", "todos"]);
    expect(f.chains("todos")[0]).toBe(TODO_LOOKUP);
    expect(f.chains("lists")).toEqual([GATE]);
    expect(f.chains("todos")[1]).toBe(write);
  });
  it("todo not visible -> NotFound (no lists query)", async () => {
    const f = fakeDb().queue("todos", { data: null });
    expect(await call(f.db)).toMatchObject({ error: { kind: "NotFound" } });
    expect(f.chains("todos")).toEqual([TODO_LOOKUP]);
    expect(f.on("lists")).toHaveLength(0);
  });
  it("viewer -> Forbidden; non-member -> NotFound", async () => {
    const f = fakeDb().queue("todos", { data: { list_id: LIST } }, { data: { list_id: LIST } })
      .queue("lists", { data: listRow("viewer") }, { data: listRow(null) });
    expect(await call(f.db)).toMatchObject({ error: { kind: "Forbidden" } });
    expect(await call(f.db)).toMatchObject({ error: { kind: "NotFound" } });
  });
  it("0 rows re-checks once: lost access -> NotFound, downgraded -> Forbidden, still ok -> NotFound", async () => {
    for (const [again, kind] of [[null, "NotFound"], ["viewer", "Forbidden"], ["editor", "NotFound"]] as const) {
      const f = fakeDb()
        .queue("todos", { data: { list_id: LIST } }, { data: [] })
        .queue("lists", { data: listRow("editor") }, { data: again ? listRow(again) : null });
      expect(await call(f.db)).toMatchObject({ error: { kind } });
      expect(f.chains("lists")).toEqual([GATE, GATE]);
      expect(f.chains("todos")).toEqual([TODO_LOOKUP, write]);
    }
  });
  it("42501 re-checks once", async () => {
    const f = fakeDb()
      .queue("todos", { data: { list_id: LIST } }, { error: { code: "42501" } })
      .queue("lists", { data: listRow("editor") }, { data: listRow("viewer") });
    expect(await call(f.db)).toMatchObject({ error: { kind: "Forbidden" } });
    expect(f.chains("lists")).toEqual([GATE, GATE]);
  });
  it("non-uuid todo id -> NotFound, no DB call", async () => {
    const f = fakeDb();
    const r = await (_n === "toggleTodo" ? toggleTodo(f.db, "x", true) : _n === "updateTodo" ? updateTodo(f.db, "x", { title: "n" }) : deleteTodo(f.db, "x"));
    expect(r).toMatchObject({ error: { kind: "NotFound" } });
    expect(f.calls).toHaveLength(0);
  });
});

describe("toggleTodo", () => {
  it("sets the given value (idempotent, not a flip)", async () => {
    const f = fakeDb().queue("todos", { data: { list_id: LIST } }, { data: [todoRow({ done: false })] }).queue("lists", { data: listRow("owner") });
    const r = await toggleTodo(f.db, TODO, false);
    expect(r).toEqual({ ok: true, data: todoObj({ done: false }) });
    expect(f.chains("todos")[1]).toBe(`update({"done":false}).eq("id","${TODO}").select()`);
  });
  it.each([["true"], [1], [null], [undefined]])("non-boolean %j -> InvalidInput done", async (v) => {
    const f = fakeDb();
    expect(await toggleTodo(f.db, TODO, v as unknown as boolean)).toMatchObject({ error: { kind: "InvalidInput", field: "done" } });
    expect(f.calls).toHaveLength(0);
  });
});

describe("updateTodo", () => {
  it("trims title and returns mapped todo", async () => {
    const f = fakeDb().queue("todos", { data: { list_id: LIST } }, { data: [todoRow({ title: "n" })] }).queue("lists", { data: listRow("editor") });
    expect(await updateTodo(f.db, TODO, { title: " n " })).toEqual({ ok: true, data: todoObj({ title: "n" }) });
    expect(f.chains("todos")[1]).toBe(`update({"title":"n"}).eq("id","${TODO}").select()`);
  });
  it("invalid titles -> InvalidInput", async () => {
    const f = fakeDb();
    expect(await updateTodo(f.db, TODO, { title: "" })).toMatchObject({ error: { kind: "InvalidInput", field: "title" } });
    expect(await updateTodo(f.db, TODO, { title: "a".repeat(501) })).toMatchObject({ error: { kind: "InvalidInput" } });
    expect(await updateTodo(f.db, TODO, undefined as never)).toMatchObject({ error: { kind: "InvalidInput" } });
  });
});

describe("deleteTodo", () => {
  it("success returns undefined data", async () => {
    const f = fakeDb().queue("todos", { data: { list_id: LIST } }, { data: [todoRow()] }).queue("lists", { data: listRow("editor") });
    expect(await deleteTodo(f.db, TODO)).toEqual({ ok: true, data: undefined });
  });
});

describe("reorderTodos", () => {
  it("calls RPC reorder_todos with ids in order", async () => {
    const f = fakeDb().queue("rpc:reorder_todos", { data: null });
    expect(await reorderTodos(f.db, LIST, [TODO, OTHER])).toEqual({ ok: true, data: undefined });
    expect(f.rpcCalls).toEqual([{ fn: "reorder_todos", args: { p_list_id: LIST, p_ids: [TODO, OTHER] } }]);
  });
  it.each([["not_found", "NotFound"], ["forbidden", "Forbidden"], ["conflict", "Conflict"]])("P0001 %s -> %s", async (message, kind) => {
    const f = fakeDb().queue("rpc:reorder_todos", { error: { code: "P0001", message } });
    expect(await reorderTodos(f.db, LIST, [TODO])).toMatchObject({ error: { kind } });
  });
  it("unknown P0001 message -> Unknown", async () => {
    const f = fakeDb().queue("rpc:reorder_todos", { error: { code: "P0001", message: "weird" } });
    expect(await reorderTodos(f.db, LIST, [TODO])).toMatchObject({ error: { kind: "Unknown" } });
  });
  it("non-uuid list or id -> NotFound without RPC", async () => {
    const f = fakeDb();
    expect(await reorderTodos(f.db, "x", [TODO])).toMatchObject({ error: { kind: "NotFound" } });
    expect(await reorderTodos(f.db, LIST, ["x"])).toMatchObject({ error: { kind: "NotFound" } });
    expect(f.rpcCalls).toHaveLength(0);
  });
  it("Unauthenticated without session", async () => {
    expect(await reorderTodos(fakeDb({ user: null }).db, LIST, [])).toMatchObject({ error: { kind: "Unauthenticated" } });
  });
});
