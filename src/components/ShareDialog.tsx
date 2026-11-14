"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AppError, ListMember, Result, Role } from "@contracts/types";
import type { SupabaseClient } from "@/lib/supabase/client";
import { changeRole, shareList, unshareList } from "@/lib/sharing";
import s from "./ui.module.css";

interface Props {
  db: SupabaseClient;
  listId: string;
  open: boolean;
  members: ListMember[];
  onClose: () => void;
  onMemberUpsert: (m: ListMember) => void;
  onMemberRemove: (id: string) => void;
}

function explain(e: AppError): string {
  if (e.kind === "InvalidEmail") return "Enter a valid email address.";
  if (e.kind === "Conflict") return "That person is already a member of this list (or is the owner).";
  return e.message;
}

export default function ShareDialog({ db, listId, open, members, onClose, onMemberUpsert, onMemberRemove }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setError(""); d.showModal(); }
    else if (!open && d.open) d.close();
  }, [open]);

  async function run<T>(call: () => Promise<Result<T>>, then: (v: T) => void) {
    if (busy) return;
    setError("");
    setBusy(true);
    const r = await call();
    setBusy(false);
    if (r.ok) then(r.data);
    else setError(explain(r.error));
  }

  function onAdd(e: FormEvent) {
    e.preventDefault();
    void run(() => shareList(db, listId, email, role), (m) => { onMemberUpsert(m); setEmail(""); });
  }

  return (
    <dialog ref={ref} className={s.dialog} aria-labelledby="share-title" onClose={onClose}>
      <h2 id="share-title">Share list</h2>
      <form onSubmit={onAdd} className={s.row}>
        <label htmlFor="share-email" className={s.srOnly}>Email to share with</label>
        <input id="share-email" type="email" required placeholder="Email" className={s.grow}
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="share-role" className={s.srOnly}>Role</label>
        <select id="share-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
        <button type="submit" disabled={busy}>Add</button>
      </form>
      <div aria-live="polite">{error && <p role="alert" className={s.error}>{error}</p>}</div>
      <h3>Members</h3>
      {members.length === 0 ? <p className={s.muted}>Not shared with anyone yet.</p> : (
        <ul className={s.list}>
          {members.map((m) => (
            <li key={m.id} className={`${s.card} ${s.between}`}>
              <span>{m.email}</span>
              <span className={s.row}>
                <select disabled={busy} aria-label={`Role for ${m.email}`} value={m.role}
                  onChange={(e) => { const role2 = e.target.value as Role; void run(() => changeRole(db, listId, m.email, role2), onMemberUpsert); }}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button type="button" disabled={busy} aria-label={`Remove ${m.email}`}
                  onClick={() => void run(() => unshareList(db, listId, m.email), () => onMemberRemove(m.id))}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onClose}>Close</button>
    </dialog>
  );
}
