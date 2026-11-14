import { describe, it, expect, vi } from "vitest";
import { subscribeToList } from "@/lib/lists";
import type { ListSubscriptionHandlers } from "@contracts/types";
import { fakeDb, listRow, todoRow, memberRow, LIST, TODO, MEMBER, OTHER } from "./helpers/fakeDb";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const handlers = () => ({
  onListUpdate: vi.fn(), onListDeleted: vi.fn(), onTodoUpsert: vi.fn(), onTodoDelete: vi.fn(),
  onMemberUpsert: vi.fn(), onMemberDelete: vi.fn(), onRoleChange: vi.fn(), onAccessRevoked: vi.fn(), onStatus: vi.fn(),
} satisfies Required<ListSubscriptionHandlers>);
const allCalls = (h: ReturnType<typeof handlers>) => Object.values(h).reduce((n, m) => n + m.mock.calls.length, 0);

/** Subscribes and drives the channel to SUBSCRIBED with the given own-role row. */
async function setup(role: string | null = "editor") {
  const f = fakeDb().queue("lists", { data: role ? { my_role: role, my_member_id: role === "owner" ? null : MEMBER } : null });
  const h = handlers();
  const unsub = subscribeToList(f.db, LIST, h);
  f.channels[0].status("SUBSCRIBED");
  await flush();
  return { f, h, unsub, ch: f.channels[0] };
}

describe("subscribeToList channel setup", () => {
  it("unique channel name list:{id}:{n} per call; two subscribes in a row both work and never throw", () => {
    const f = fakeDb();
    let u1!: () => void, u2!: () => void;
    expect(() => { u1 = subscribeToList(f.db, LIST, {}); u2 = subscribeToList(f.db, LIST, {}); }).not.toThrow();
    const [a, b] = f.channels.map((c) => c.name);
    expect(a).toMatch(new RegExp(`^list:${LIST}:\\d+$`));
    expect(b).toMatch(new RegExp(`^list:${LIST}:\\d+$`));
    expect(a).not.toBe(b);
    expect(f.channels).toHaveLength(2);
    // both channels fully wired (8 subscriptions each) and independent
    expect(f.channels.map((c) => c.regs.length)).toEqual([8, 8]);
    u1(); u2();
    expect(f.removed).toEqual(f.channels);
  });
  it("registers the 8 postgres_changes with contract filters", () => {
    const f = fakeDb();
    subscribeToList(f.db, LIST, {});
    expect(f.channels[0].regs.map((r) => [r.cfg.table, r.cfg.event, r.cfg.filter])).toEqual([
      ["lists", "UPDATE", `id=eq.${LIST}`], ["lists", "DELETE", undefined],
      ["todos", "INSERT", `list_id=eq.${LIST}`], ["todos", "UPDATE", `list_id=eq.${LIST}`], ["todos", "DELETE", undefined],
      ["list_members", "INSERT", `list_id=eq.${LIST}`], ["list_members", "UPDATE", `list_id=eq.${LIST}`], ["list_members", "DELETE", undefined],
    ]);
  });
  it.each([
    ["db.channel throws", { channelThrows: true }],
    [".on throws", { onThrows: true }],
    [".subscribe throws", { subscribeThrows: true }],
  ])("setup failure (%s): no throw, onStatus(CHANNEL_ERROR, Unknown), Unsubscribe still returned", async (_n, o) => {
    const f = fakeDb(o);
    const h = handlers();
    let unsub!: () => void;
    expect(() => { unsub = subscribeToList(f.db, LIST, h); }).not.toThrow();
    await flush();
    expect(h.onStatus).toHaveBeenCalledWith("CHANNEL_ERROR", expect.objectContaining({ kind: "Unknown" }));
    expect(() => { unsub(); unsub(); }).not.toThrow();
  });
  it("setup failure then immediate unsubscribe: no onStatus fires", async () => {
    const f = fakeDb({ channelThrows: true });
    const h = handlers();
    subscribeToList(f.db, LIST, h)();
    await flush();
    expect(allCalls(h)).toBe(0);
  });
  it("invalid id: onAccessRevoked via microtask, no channel; unsubscribing first suppresses it", async () => {
    const f = fakeDb();
    const h = handlers();
    subscribeToList(f.db, "nope", h);
    expect(h.onAccessRevoked).not.toHaveBeenCalled(); // async, caller has Unsubscribe first
    await flush();
    expect(h.onAccessRevoked).toHaveBeenCalledTimes(1);
    expect(f.channels).toHaveLength(0);

    const h2 = handlers();
    subscribeToList(f.db, "nope", h2)();
    await flush();
    expect(allCalls(h2)).toBe(0);
  });
});

describe("channel reuse (realtime-js semantics)", () => {
  it("the fake returns the existing channel for a reused name and throws on .on() after subscribe", () => {
    const f = fakeDb();
    const a = f.db.channel("same") as unknown as { on: (...a: unknown[]) => unknown; subscribe: (cb: () => void) => unknown };
    a.on("postgres_changes", { event: "*", table: "t" }, () => {});
    a.subscribe(() => {});
    const b = f.db.channel("same");
    expect(b).toBe(a);
    expect(() => (b as unknown as typeof a).on("postgres_changes", { event: "*", table: "t" }, () => {})).toThrow(/after subscribe/);
  });
  it("subscribing twice to one list while the first is still joining gets 2 distinct channels, no onStatus error", () => {
    const f = fakeDb();
    const h1 = handlers(), h2 = handlers();
    subscribeToList(f.db, LIST, h1);
    f.channels[0].status("TIMED_OUT"); // first still not SUBSCRIBED
    subscribeToList(f.db, LIST, h2);
    expect(f.channels).toHaveLength(2);
    expect(h2.onStatus).not.toHaveBeenCalled();
    expect(h1.onStatus).toHaveBeenCalledTimes(1);
  });
});

describe("status + own member re-check", () => {
  it("forwards status (and error) to onStatus", () => {
    const f = fakeDb();
    const h = handlers();
    subscribeToList(f.db, LIST, h);
    f.channels[0].status("TIMED_OUT");
    f.channels[0].status("CHANNEL_ERROR", new Error("x"));
    expect(h.onStatus).toHaveBeenNthCalledWith(1, "TIMED_OUT", undefined);
    expect(h.onStatus).toHaveBeenNthCalledWith(2, "CHANNEL_ERROR", expect.objectContaining({ kind: "Unknown", message: "x" }));
  });
  it("SUBSCRIBED runs the my_role/my_member_id re-check on every (re)subscribe", async () => {
    const { f, ch } = await setup("viewer");
    expect(f.on("lists")[0].ops[0]).toEqual(["select", ["my_role, my_member_id"]]);
    f.queue("lists", { data: { my_role: "viewer", my_member_id: MEMBER } });
    ch.status("CLOSED"); ch.status("SUBSCRIBED");
    await flush();
    expect(f.on("lists")).toHaveLength(2);
  });
  it("re-check: no row or NULL my_role -> onAccessRevoked", async () => {
    expect((await setup(null)).h.onAccessRevoked).toHaveBeenCalledTimes(1);
    const f = fakeDb().queue("lists", { data: { my_role: null, my_member_id: null } });
    const h = handlers();
    subscribeToList(f.db, LIST, h);
    f.channels[0].status("SUBSCRIBED");
    await flush();
    expect(h.onAccessRevoked).toHaveBeenCalledTimes(1);
  });
  it("re-check error or throw -> onStatus(CHANNEL_ERROR)", async () => {
    const f = fakeDb().queue("lists", { error: { code: "XX", message: "bad" } }, () => { throw new Error("kaboom"); });
    const h = handlers();
    subscribeToList(f.db, LIST, h);
    f.channels[0].status("SUBSCRIBED"); await flush();
    f.channels[0].status("SUBSCRIBED"); await flush();
    expect(h.onStatus.mock.calls.filter((c) => c[0] === "CHANNEL_ERROR")).toHaveLength(2);
  });
  it("re-check resolving after unsubscribe fires nothing", async () => {
    const f = fakeDb().queue("lists", { data: null });
    const h = handlers();
    const unsub = subscribeToList(f.db, LIST, h);
    f.channels[0].status("SUBSCRIBED");
    unsub(); // before the async re-check resolves
    await flush();
    expect(h.onAccessRevoked).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenCalledTimes(1); // only the SUBSCRIBED delivered before unsubscribe
  });
});

describe("event mapping", () => {
  it("lists UPDATE -> onListUpdate(List); lists DELETE only for this id -> onListDeleted", async () => {
    const { h, ch } = await setup();
    ch.emit("lists", "UPDATE", { new: listRow("owner", { title: "Renamed" }) });
    expect(h.onListUpdate).toHaveBeenCalledWith({ id: LIST, ownerId: expect.any(String), title: "Renamed", createdAt: expect.any(String) });
    ch.emit("lists", "DELETE", { old: { id: OTHER } });
    expect(h.onListDeleted).not.toHaveBeenCalled();
    ch.emit("lists", "DELETE", { old: { id: LIST } });
    expect(h.onListDeleted).toHaveBeenCalledTimes(1);
  });
  it("todos INSERT/UPDATE -> onTodoUpsert(camelCase Todo)", async () => {
    const { h, ch } = await setup();
    ch.emit("todos", "INSERT", { new: todoRow() });
    ch.emit("todos", "UPDATE", { new: todoRow({ done: true }) });
    expect(h.onTodoUpsert).toHaveBeenCalledTimes(2);
    expect(h.onTodoUpsert.mock.calls[1][0]).toMatchObject({ id: TODO, listId: LIST, done: true, updatedAt: expect.any(String) });
  });
  it("todos DELETE (id only, any list) -> onTodoDelete(id)", async () => {
    const { h, ch } = await setup();
    ch.emit("todos", "DELETE", { old: { id: OTHER } });
    expect(h.onTodoDelete).toHaveBeenCalledWith(OTHER);
  });
  it("members INSERT -> onMemberUpsert only", async () => {
    const { h, ch } = await setup();
    ch.emit("list_members", "INSERT", { new: memberRow() });
    expect(h.onMemberUpsert).toHaveBeenCalledTimes(1);
    expect(h.onRoleChange).not.toHaveBeenCalled();
  });
  it("members UPDATE of own row -> onMemberUpsert then onRoleChange; other row -> no onRoleChange", async () => {
    const { h, ch } = await setup("viewer");
    const order: string[] = [];
    h.onMemberUpsert.mockImplementation(() => order.push("upsert"));
    h.onRoleChange.mockImplementation(() => order.push("role"));
    ch.emit("list_members", "UPDATE", { new: memberRow({ id: MEMBER, role: "editor" }) });
    expect(order).toEqual(["upsert", "role"]);
    expect(h.onRoleChange).toHaveBeenCalledWith("editor");
    ch.emit("list_members", "UPDATE", { new: memberRow({ id: OTHER, role: "viewer" }) });
    expect(h.onRoleChange).toHaveBeenCalledTimes(1);
  });
  it("owner (member id NULL) never gets onRoleChange / onAccessRevoked from member events", async () => {
    const { h, ch } = await setup("owner");
    ch.emit("list_members", "UPDATE", { new: memberRow() });
    ch.emit("list_members", "DELETE", { old: { id: MEMBER } });
    expect(h.onRoleChange).not.toHaveBeenCalled();
    expect(h.onAccessRevoked).not.toHaveBeenCalled();
  });
  it("members DELETE: id only to onMemberDelete (never an email); own row -> onAccessRevoked", async () => {
    const { h, ch } = await setup("editor");
    ch.emit("list_members", "DELETE", { old: { id: OTHER, email: "leak@x.co" } });
    expect(h.onMemberDelete).toHaveBeenCalledWith(OTHER);
    expect(h.onAccessRevoked).not.toHaveBeenCalled();
    ch.emit("list_members", "DELETE", { old: { id: MEMBER } });
    expect(h.onMemberDelete).toHaveBeenLastCalledWith(MEMBER);
    expect(h.onAccessRevoked).toHaveBeenCalledTimes(1);
    for (const c of h.onMemberDelete.mock.calls) expect(c).toHaveLength(1);
    expect(JSON.stringify(h.onMemberDelete.mock.calls)).not.toContain("@");
  });
  it("missing optional handlers and throwing handlers never break the channel", async () => {
    const f = fakeDb().queue("lists", { data: { my_role: "editor", my_member_id: MEMBER } });
    const h = handlers();
    h.onTodoUpsert.mockImplementation(() => { throw new Error("ui bug"); });
    subscribeToList(f.db, LIST, { onTodoUpsert: h.onTodoUpsert });
    const ch = f.channels[0];
    expect(() => ch.emit("todos", "INSERT", { new: todoRow() })).not.toThrow();
    expect(() => ch.emit("list_members", "DELETE", { old: { id: MEMBER } })).not.toThrow();
  });
});

describe("unsubscribe", () => {
  it("removes channel once; idempotent", async () => {
    const { f, unsub, ch } = await setup();
    unsub(); unsub();
    expect(f.removed).toEqual([ch]);
  });
  it("no handler fires after unsubscribe (events, statuses)", async () => {
    const { f, h, unsub, ch } = await setup();
    const before = allCalls(h);
    const queries = f.on("lists").length;
    unsub();
    ch.emit("lists", "UPDATE", { new: listRow("owner") });
    ch.emit("lists", "DELETE", { old: { id: LIST } });
    ch.emit("todos", "INSERT", { new: todoRow() });
    ch.emit("todos", "DELETE", { old: { id: TODO } });
    ch.emit("list_members", "INSERT", { new: memberRow() });
    ch.emit("list_members", "UPDATE", { new: memberRow() });
    ch.emit("list_members", "DELETE", { old: { id: MEMBER } });
    ch.status("CLOSED"); ch.status("SUBSCRIBED");
    await flush();
    expect(allCalls(h)).toBe(before);
    expect(f.on("lists")).toHaveLength(queries); // a late SUBSCRIBED must not even run the re-check
  });
  it("removeChannel rejecting does not surface", async () => {
    const f = fakeDb({ removeChannelRejects: true });
    const unsub = subscribeToList(f.db, LIST, {});
    expect(() => unsub()).not.toThrow();
    await flush(); // an unhandled rejection would fail the run
    expect(f.removed).toEqual([f.channels[0]]);
  });
});
