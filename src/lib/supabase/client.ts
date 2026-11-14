import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./env";

export type { SupabaseClient };

export function createClient(): SupabaseClient {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
