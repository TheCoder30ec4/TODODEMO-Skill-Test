import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

// Refreshes the Supabase auth session cookies on each request. No redirects: pages decide.
export async function middleware(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });
  // Cache headers from @supabase/ssr (once per client); must survive response re-creation.
  const cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        Object.assign(cacheHeaders, headers);
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // getUser returns network/auth failures rather than throwing; this only guards unexpected bugs.
    console.error("middleware: Supabase session refresh failed");
  }
  // Only on refresh: keeps Set-Cookie responses out of shared caches.
  for (const [k, v] of Object.entries(cacheHeaders)) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|otf|webmanifest)$).*)"],
};
