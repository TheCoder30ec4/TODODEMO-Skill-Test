import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Same-origin relative path only: single leading "/", no "//", no backslash, no scheme.
function safeNext(next: string | null): string {
  return next && /^\/(?![/\\])/.test(next) && !/[\u0000-\u001f]/.test(next) ? next : "/lists";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const fail = NextResponse.redirect(`${origin}/login?error=1`);
  if (!code) return fail;
  try {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) return fail;
  } catch {
    return fail;
  }
  return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
}
