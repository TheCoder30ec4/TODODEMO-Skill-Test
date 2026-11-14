import { describe, it, expect } from "vitest";
import { addTodo, toggleTodo, updateTodo, deleteTodo, reorderTodos } from "@/lib/lists";
import { fakeDb, listRow, todoRow, LIST, TODO, OTHER } from "./helpers/fakeDb";

describe("addTodo", () => {
  it("position = max + 1, done false, trimmed title", async () => {
    const f = fakeDb()
      .queue("lists", { data: listRow("editor") })
      .queue("todos", { data: { position: 4 } }, { data: [todoRow({ position: 5, title: "x" })] });
    const r = await addTodo(f.db, LIST, "  x ");
    expect(r).toMatchObject({ ok: true, data: { position: 5, title: "x", listId: LIST } });
    expect(f.on("todos")[1].ops[0]).toEqual(["insert", [{ list_id: LIST, title: "x", done: false, position: 5 }]]);
  });
  it("empty list -> position 0", async () => {
    const f = fakeDb().queue("lists", { data: listRow("owner") }).queue("todos", { data: null }, { data: [todoRow()] });
    await addTodo(f.db, LIST, "x");
    expect(f.on("todos")[1].ops[0][1]).toEqual([expect.objectContaining({ position: 0 })]);
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
const todoFns: [string, (db: ReturnType<typeof fakeDb>["db"]) => Promise<{ ok: boolean; error?: { kind: string } }>][] = [
  ["toggleTodo", (db) => toggleTodo(db, TODO, true)],
  ["updateTodo", (db) => updateTodo(db, TODO, { title: "n" })],
  ["deleteTodo", (db) => deleteTodo(db, TODO)],
];
describe.each(todoFns)("%s access gate", (_n, call) => {
  it("resolves list_id from todos first, then gates on lists", async () => {
    const f = fakeDb()
      .queue("todos", { data: { list_id: LIST } }, { data: [todoRow()] })
      .queue("lists", { data: listRow("editor") });
    expect((await call(f.db)).ok).toBe(true);
    expect(f.calls.map((c) => c.table)).toEqual(["todos", "lists", "todos"]);
    expect(f.calls[0].ops[0]).toEqual(["select", ["list_id"]]);
  });
  it("todo not visible -> NotFound (no lists query)", async () => {
    const f = fakeDb().queue("todos", { data: null });
    expect(await call(f.db)).toMatchObject({ error: { kind: "NotFound" } });
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
      expect(f.on("lists")).toHaveLength(2);
    }
  });
  it("42501 re-checks once", async () => {
    const f = fakeDb()
      .queue("todos", { data: { list_id: LIST } }, { error: { code: "42501" } })
      .queue("lists", { data: listRow("editor") }, { data: listRow("viewer") });
    expect(await call(f.db)).toMatchObject({ error: { kind: "Forbidden" } });
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
    expect(r).toMatchObject({ ok: true, data: { done: false } });
    expect(f.on("todos")[1].ops[0]).toEqual(["update", [{ done: false }]]);
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
    expect(await updateTodo(f.db, TODO, { title: " n " })).toMatchObject({ ok: true, data: { title: "n" } });
    expect(f.on("todos")[1].ops[0]).toEqual(["update", [{ title: "n" }]]);
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
    const f = fakeDb();
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
