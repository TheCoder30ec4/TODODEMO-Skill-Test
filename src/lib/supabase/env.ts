// Placeholders keep `next build` and unit tests from crashing without real keys.
// They point at nothing, so any real request fails loudly.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "missing-anon-key";
