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

const req = () => new NextRequest("http://localhost/", { headers: { cookie: "keep=1" } });
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
  });
  it("refreshed cookies reach the browser (Set-Cookie) AND the forwarded request (x-middleware-request-cookie)", async () => {
    state.getUser = async () => { setAll([{ name: "sb", value: "fresh", options: { path: "/" } }], CACHE); return {}; };
    const res = await middleware(req());
    expect(res.cookies.get("sb")?.value).toBe("fresh");
    expect(res.headers.get("set-cookie")).toMatch(/sb=fresh/);
    // NextResponse.next({ request }) forwards the (updated) request cookies to the page via this header.
    const fwd = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(fwd).toContain("sb=fresh");
    expect(fwd).toContain("keep=1");
    expect(res.headers.get("x-middleware-override-headers")).toMatch(/cookie/);
  });
  it("no cache headers (and no Set-Cookie) when setAll never ran", async () => {
    state.getUser = async () => ({});
    const res = await middleware(req());
    expect(res.headers.get("cache-control")).toBeNull();
    expect(res.headers.get("pragma")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("headers survive a second setAll call (response re-created); earlier cookie still forwarded", async () => {
    state.getUser = async () => {
      setAll([{ name: "a", value: "1" }], CACHE);
      setAll([{ name: "b", value: "2" }], {});
      return {};
    };
    const res = await middleware(req());
    expect(res.headers.get("cache-control")).toBe(CACHE["cache-control"]);
    expect(res.cookies.get("b")?.value).toBe("2");
    const fwd = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(fwd).toContain("a=1");
    expect(fwd).toContain("b=2");
  });
  it("getUser throwing: console.error gets exactly one constant string; nothing secret in any argument", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.getUser = async () => { throw new Error("jwt eyJhbGciSECRET anon-key-123"); };
    const res = await middleware(req());
    expect(res.status).toBe(200);
    expect(spy.mock.calls).toEqual([["middleware: Supabase session refresh failed"]]);
    for (const args of spy.mock.calls) {
      for (const a of args) {
        expect(typeof a).toBe("string"); // no Error objects or other objects
        expect(String(a)).not.toMatch(/SECRET|anon-key|eyJ/);
      }
    }
  });
});
