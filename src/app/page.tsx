import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (data.user) redirect("/lists");
  return (
    <main className="container">
      <h1>TODODEMO</h1>
      <p>Shared todo lists that update live for everyone you share them with.</p>
      <Link href="/login">Sign in with a magic link</Link>
    </main>
  );
}
