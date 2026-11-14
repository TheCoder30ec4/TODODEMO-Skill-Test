import { describe, it, expect, afterEach, vi } from "vitest";
import { getSupabaseEnv } from "@/lib/supabase/env";

const URL_K = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_K = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
afterEach(() => vi.unstubAllEnvs());
// vi.stubEnv with undefined deletes the variable.
const env = (o: Record<string, string | undefined>) => Object.entries(o).forEach(([k, v]) => vi.stubEnv(k, v as string));

describe("getSupabaseEnv", () => {
  it("returns real values when both set", () => {
    env({ NODE_ENV: "production", [URL_K]: "https://x.supabase.co", [KEY_K]: "anon" });
    expect(getSupabaseEnv()).toEqual({ url: "https://x.supabase.co", anonKey: "anon" });
  });
  it.each(["test", "development"])("placeholders in %s when unset", (n) => {
    env({ NODE_ENV: n, [URL_K]: undefined, [KEY_K]: undefined });
    const r = getSupabaseEnv();
    expect(r.url).toMatch(/^http/);
    expect(r.anonKey).toBeTruthy();
  });
  it("placeholders during the production build phase", () => {
    env({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", [URL_K]: undefined, [KEY_K]: undefined });
    expect(getSupabaseEnv().url).toMatch(/^http/);
  });
  it("production runtime: throws naming both missing variables", () => {
    env({ NODE_ENV: "production", NEXT_PHASE: undefined, [URL_K]: undefined, [KEY_K]: undefined });
    expect(() => getSupabaseEnv()).toThrow(new RegExp(`${URL_K}.*${KEY_K}`));
  });
  it("production runtime: names only the missing one and never prints the other's value", () => {
    env({ NODE_ENV: "production", NEXT_PHASE: undefined, [URL_K]: "https://secret-host.supabase.co", [KEY_K]: undefined });
    let msg = "";
    try { getSupabaseEnv(); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain(KEY_K);
    expect(msg).not.toContain(URL_K);
    expect(msg).not.toContain("secret-host");
    env({ NODE_ENV: "production", [URL_K]: undefined, [KEY_K]: "s3cr3t-anon" });
    try { getSupabaseEnv(); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain(URL_K);
    expect(msg).not.toContain("s3cr3t-anon");
  });
});
