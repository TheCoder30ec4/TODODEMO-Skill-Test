import { describe, it, expect } from "vitest";
import type { Todo } from "@contracts/types";
import { applyUpsert, applyDelete, rollback, restoreDeleted, reconcile, cmpUpdated } from "@/components/listMerge";

const todo = (id: string, updatedAt = "2025-01-01T00:00:00.000Z", extra: Partial<Todo> = {}): Todo => ({
  id, listId: "L", title: id, done: false, position: 0, createdBy: null, createdAt: "2025-01-01T00:00:00.000Z", updatedAt, ...extra,
});
const mapOf = (...ts: Todo[]) => new Map(ts.map((t) => [t.id, t]));
const T1 = "2025-01-01T00:00:00.000Z", T2 = "2025-01-01T00:00:01.000Z", T3 = "2025-01-01T00:00:02.000Z";

describe("cmpUpdated", () => {
  it("compares as instants, not strings (different formats of the same moment are equal)", () => {
    expect(cmpUpdated("2025-01-01T00:00:00Z", "2025-01-01T00:00:00.000Z")).toBe(0);
    expect(cmpUpdated("2025-01-01T01:00:00+01:00", "2025-01-01T00:00:00Z")).toBe(0);
    // string order would say "...+00:00" > "...Z"? instants say later is later
    expect(cmpUpdated("2025-01-01T00:00:00.5Z", "2025-01-01T00:00:00Z")).toBeGreaterThan(0);
    expect(cmpUpdated(T1, T2)).toBeLessThan(0);
    expect(cmpUpdated(T3, T2)).toBeGreaterThan(0);
  });
  it("unparsable values fall back to string order, never NaN", () => {
    expect(cmpUpdated("a", "b")).toBe(-1);
    expect(cmpUpdated("b", "a")).toBe(1);
    expect(cmpUpdated("a", "a")).toBe(0);
    expect(cmpUpdated("garbage", T1)).toBe(T1 < "garbage" ? 1 : -1); // one side unparsable
    expect(Number.isNaN(cmpUpdated("x", ""))).toBe(false);
  });
});

describe("applyUpsert (rule 3)", () => {
  it("inserts absent ids; ignores tombstoned ids and returns the same map", () => {
    const m = mapOf();
    expect(applyUpsert(m, new Set(), todo("a")).get("a")).toBeDefined();
    expect(applyUpsert(m, new Set(["a"]), todo("a"))).toBe(m);
  });
  it("replaces only when incoming >= local; older incoming returns same map", () => {
    const cur = todo("a", T2, { title: "cur" });
    const m = mapOf(cur);
    expect(applyUpsert(m, new Set(), todo("a", T1, { title: "old" }))).toBe(m);
    expect(applyUpsert(m, new Set(), todo("a", T2, { title: "eq" })).get("a")!.title).toBe("eq");
    expect(applyUpsert(m, new Set(), todo("a", T3, { title: "new" })).get("a")!.title).toBe("new");
    expect(m.get("a")).toBe(cur); // input not mutated
  });
});

describe("applyDelete (rule 4)", () => {
  it("removes, tombstones (mutating the set), and unknown ids are tombstoned with the same map", () => {
    const d = new Set<string>();
    const m = mapOf(todo("a"));
    const n = applyDelete(m, d, "a");
    expect(n.has("a")).toBe(false);
    expect(m.has("a")).toBe(true);
    expect(d.has("a")).toBe(true);
    const same = applyDelete(n, d, "zzz");
    expect(same).toBe(n);
    expect(d.has("zzz")).toBe(true);
  });
});

describe("rollback: failed optimistic edit must not clobber a newer update from another user", () => {
  const prev = todo("a", T1, { title: "orig" });
  const optimistic = { ...prev, title: "mine" };
  it("restores prev when the optimistic object is still what is in the map", () => {
    expect(rollback(mapOf(optimistic), new Set(), prev, optimistic).get("a")).toBe(prev);
  });
  it("a newer server update replaced the optimistic object -> rollback is a no-op (same map)", () => {
    const theirs = todo("a", T3, { title: "theirs" });
    const m = mapOf(theirs);
    expect(rollback(m, new Set(), prev, optimistic)).toBe(m);
    expect(m.get("a")).toBe(theirs);
  });
  it("tombstoned or missing id -> no resurrection", () => {
    const m = mapOf(optimistic);
    expect(rollback(m, new Set(["a"]), prev, optimistic)).toBe(m);
    const empty = mapOf();
    expect(rollback(empty, new Set(), prev, optimistic)).toBe(empty);
  });
});

describe("restoreDeleted: failed optimistic delete", () => {
  const t = todo("a");
  it("re-adds a todo that is not tombstoned and not present", () => {
    expect(restoreDeleted(mapOf(), new Set(), t).get("a")).toBe(t);
  });
  it("does not resurrect an id that is in the deleted set (someone else deleted it meanwhile)", () => {
    const m = mapOf();
    expect(restoreDeleted(m, new Set(["a"]), t)).toBe(m);
  });
  it("does not overwrite a copy already present", () => {
    const m = mapOf(todo("a", T3));
    expect(restoreDeleted(m, new Set(), t)).toBe(m);
  });
  it("NotFound on delete counts as success: the UI tombstones (applyDelete), so a later restore is a no-op", () => {
    const d = new Set<string>();
    const afterRemove = applyDelete(mapOf(t), d, "a");
    expect(restoreDeleted(afterRemove, d, t)).toBe(afterRemove);
    expect(afterRemove.has("a")).toBe(false);
  });
});

describe("reconcile (rule 9 reconnect)", () => {
  it("merges snapshot via rule 3 (never overwrites newer local data)", () => {
    const m = mapOf(todo("a", T3, { title: "local-new" }));
    const out = reconcile(m, new Set(), [todo("a", T1, { title: "stale" }), todo("b", T1)], new Set(["a"]));
    expect(out.get("a")!.title).toBe("local-new");
    expect(out.has("b")).toBe(true);
  });
  it("drops ids present BEFORE the refetch and missing from the snapshot", () => {
    const m = mapOf(todo("a"), todo("b"));
    const out = reconcile(m, new Set(), [todo("a")], new Set(["a", "b"]));
    expect([...out.keys()]).toEqual(["a"]);
  });
  it("keeps todos that arrived DURING the refetch (not in `before`), including the user's own", () => {
    const m = mapOf(todo("a"), todo("mine"), todo("theirs"));
    const out = reconcile(m, new Set(), [todo("a")], new Set(["a"]));
    expect([...out.keys()].sort()).toEqual(["a", "mine", "theirs"]);
  });
  it("an id in `before` that is already gone locally and missing from the snapshot changes nothing (same map)", () => {
    const m = mapOf(todo("a"));
    expect(reconcile(m, new Set(), [], new Set(["already-gone"]))).toBe(m);
  });
  it("tombstoned snapshot ids stay out; unchanged result returns the same map", () => {
    const m = mapOf(todo("a"));
    expect(reconcile(m, new Set(), [], new Set())).toBe(m);
    expect(reconcile(mapOf(), new Set(["x"]), [todo("x")], new Set()).has("x")).toBe(false);
  });
});
