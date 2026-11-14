// Literal process.env.NEXT_PUBLIC_* reads are required so Next inlines them in the browser bundle.
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey) return { url, anonKey };

  // Fail loudly at runtime in production; the build phase and dev/test get inert placeholders.
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Missing required environment variable(s): ${missing}`);
  }
  return { url: url || "http://localhost:54321", anonKey: anonKey || "missing-anon-key" };
}
