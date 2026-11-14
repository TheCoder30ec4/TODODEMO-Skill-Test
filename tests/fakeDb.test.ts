import { describe, it, expect } from "vitest";
import { fakeDb } from "./helpers/fakeDb";

// Sanity check of the strictness machinery itself (the global afterEach in fakeDb.ts relies on it).
describe("fakeDb strictness", () => {
  it("records unexpected calls and reports unconsumed responses", async () => {
    const f = fakeDb().queue("lists", { data: [] });
    expect(() => f.assertDrained()).toThrow(/unconsumed/);
    await f.db.from("lists").select();
    expect(() => f.assertDrained()).not.toThrow();
    await expect(Promise.resolve(f.db.from("todos").select())).rejects.toThrow(/unexpected call/);
    expect(f.unexpected).toHaveLength(1);
    f.unexpected.length = 0; // handled here, so the global afterEach does not fail this test
  });
});
