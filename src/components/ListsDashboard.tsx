"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ListWithRole } from "@contracts/types";
import { createClient } from "@/lib/supabase/client";
import { createList, deleteList, listLists } from "@/lib/lists";
import s from "./ui.module.css";

export default function ListsDashboard() {
  const db = useMemo(() => createClient(), []);
  const router = useRouter();
  const [lists, setLists] = useState<ListWithRole[] | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("revoked")) {
      setNotice("That list is no longer available.");
    }
    listLists(db).then((r) => {
      if (r.ok) setLists(r.data);
      else if (r.error.kind === "Unauthenticated") router.replace("/login");
      else { setError(r.error.message); setLists([]); }
    });
  }, [db, router]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    const r = await createList(db, title);
    if (!r.ok) return setError(r.error.message);
    setLists((l) => [r.data, ...(l ?? [])]);
    setTitle("");
  }

  async function onDelete(l: ListWithRole) {
    if (!window.confirm(`Delete "${l.title}" and all its todos?`)) return;
    setError("");
    const r = await deleteList(db, l.id);
    if (!r.ok) return setError(r.error.message);
    setLists((x) => (x ?? []).filter((i) => i.id !== l.id));
  }

  async function onSignOut() {
    db.removeAllChannels();
    await db.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="container">
      <div className={s.between}>
        <h1>Your lists</h1>
        <button type="button" onClick={onSignOut}>Sign out</button>
      </div>
      {notice && <p role="status" className={s.notice}>{notice}</p>}
      <form onSubmit={onCreate} className={s.row}>
        <label htmlFor="new-list" className="sr-only" style={{ position: "absolute", left: "-9999px" }}>New list title</label>
        <input id="new-list" className={s.grow} placeholder="New list title" required maxLength={200}
          value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit">Create list</button>
      </form>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {lists === null ? <p className={s.muted}>Loading...</p> : lists.length === 0 ? (
        <p className={s.muted}>No lists yet. Create one above.</p>
      ) : (
        <ul className={s.list}>
          {lists.map((l) => (
            <li key={l.id} className={`${s.card} ${s.between}`}>
              <span className={s.row}>
                <Link href={`/lists/${l.id}`}>{l.title}</Link>
                <span className={s.badge}>{l.role}</span>
              </span>
              {l.role === "owner" && (
                <button type="button" onClick={() => onDelete(l)} aria-label={`Delete ${l.title}`}>Delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
