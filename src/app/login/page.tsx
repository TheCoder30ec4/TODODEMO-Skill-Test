"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import s from "@/components/ui.module.css";

type State = { kind: "idle" | "sending" | "sent" } | { kind: "error"; message: string };

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(new URLSearchParams(window.location.search).has("error")), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setState({ kind: "sending" });
    try {
      const { error } = await createClient().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setState(error ? { kind: "error", message: error.message } : { kind: "sent" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Could not send the link." });
    }
  }

  return (
    <main className="container">
      <h1>Sign in</h1>
      {failed && state.kind === "idle" && (
        <p role="alert" className={s.error}>Sign-in failed or the link expired. Request a new link.</p>
      )}
      <form onSubmit={onSubmit}>
        <div className={s.field}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Sending..." : "Send magic link"}
        </button>
      </form>
      <div aria-live="polite">
        {state.kind === "sent" && <p className={s.ok}>Check your email for the sign-in link.</p>}
        {state.kind === "error" && <p role="alert" className={s.error}>{state.message}</p>}
      </div>
    </main>
  );
}
