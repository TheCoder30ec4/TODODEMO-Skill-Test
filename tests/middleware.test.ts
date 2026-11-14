import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

type SetAll = (c: { name: string; value: string; options?: object }[], h: Record<string, string>) => void;
const state = vi.hoisted(() => ({
  setAll: undefined as undefined | ((...a: never[]) => void),
  getUser: (async () => ({})) as () => Promise<unknown>,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, o: { cookies: { setAll: SetAll } }) => {
    state.setAll = o.cookies.setAll as never;
    return { auth: { getUser: () => state.getUser() } };
  },
}));
import { middleware } from "@/middleware";

const req = () => new NextRequest("http://localhost/");
const CACHE = { "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0", expires: "0", pragma: "no-cache" };
const setAll = (c: Parameters<SetAll>[0], h: Parameters<SetAll>[1]) => (state.setAll as unknown as SetAll)(c, h);

beforeEach(() => { state.setAll = undefined; });
afterEach(() => vi.restoreAllMocks());

describe("middleware", () => {
  it("headers passed to setAll end up on the returned response, with the cookie", async () => {
    state.getUser = async () => { setAll([{ name: "sb", value: "v", options: { path: "/" } }], CACHE); return {}; };
    const res = await middleware(req());
    expect(res.headers.get("cache-control")).toBe(CACHE["cache-control"]);
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("expires")).toBe("0");
    expect(res.cookies.get("sb")?.value).toBe("v");
  });
  it("no cache headers when setAll never ran", async () => {
    state.getUser = async () => ({});
    const res = await middleware(req());
    expect(res.headers.get("cache-control")).toBeNull();
    expect(res.headers.get("pragma")).toBeNull();
  });
  it("headers survive a second setAll call (response re-created)", async () => {
    state.getUser = async () => {
      setAll([{ name: "a", value: "1" }], CACHE);
      setAll([{ name: "b", value: "2" }], {});
      return {};
    };
    const res = await middleware(req());
    expect(res.headers.get("cache-control")).toBe(CACHE["cache-control"]);
    expect(res.cookies.get("b")?.value).toBe("2");
  });
  it("getUser throwing: logs a message without secrets, still returns a response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.getUser = async () => { throw new Error("jwt eyJhbGciSECRET anon-key-123"); };
    const res = await middleware(req());
    expect(res.status).toBe(200);
    const logged = JSON.stringify(spy.mock.calls);
    expect(spy).toHaveBeenCalled();
    expect(logged).not.toMatch(/SECRET|anon-key|eyJ/);
  });
});
