"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AppError, ChannelStatus, ListMember, ListWithRole, Todo } from "@contracts/types";
import { createClient } from "@/lib/supabase/client";
import { addTodo, deleteTodo, getList, subscribeToList, toggleTodo, updateTodo } from "@/lib/lists";
import { listMembers } from "@/lib/sharing";
import ShareDialog from "./ShareDialog";
import TodoItem from "./TodoItem";
import s from "./ui.module.css";

const byOrder = (a: Todo, b: Todo) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export default function ListView({ listId }: { listId: string }) {
  const db = useMemo(() => createClient(), []);
  const router = useRouter();
  const [list, setList] = useState<ListWithRole | null>(null);
  const [todos, setTodos] = useState<Map<string, Todo>>(new Map());
  const [members, setMembers] = useState<Map<string, ListMember>>(new Map());
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const deleted = useRef(new Set<string>());
  const shareBtn = useRef<HTMLButtonElement>(null);

  // Rule 3: server updatedAt ordering plus tombstones.
  const upsert = useCallback((t: Todo) => {
    if (deleted.current.has(t.id)) return;
    setTodos((m) => {
      const cur = m.get(t.id);
      if (cur && t.updatedAt < cur.updatedAt) return m;
      return new Map(m).set(t.id, t);
    });
  }, []);
  const remove = useCallback((id: string) => {
    deleted.current.add(id);
    setTodos((m) => { if (!m.has(id)) return m; const n = new Map(m); n.delete(id); return n; });
  }, []);

  const leave = useCallback(() => router.replace("/lists?revoked=1"), [router]);

  useEffect(() => {
    let wasDown = false;
    let first = true;

    async function refresh(reconnect: boolean) {
      const [d, mem] = await Promise.all([getList(db, listId), listMembers(db, listId)]);
      if (!d.ok) {
        if (d.error.kind === "Unauthenticated") router.replace("/login");
        else if (d.error.kind === "NotFound" || d.error.kind === "Forbidden") leave();
        else setError(d.error.message);
        return;
      }
      setList(d.data.list);
      d.data.todos.forEach(upsert);
      if (reconnect) { // missed deletes are not replayed: drop todos absent from the snapshot
        const ids = new Set(d.data.todos.map((t) => t.id));
        setTodos((m) => new Map([...m].filter(([id]) => ids.has(id))));
      }
      if (mem.ok) setMembers(new Map(mem.data.map((x) => [x.id, x])));
    }

    const unsub = subscribeToList(db, listId, {
      onListUpdate: (l) => setList((c) => (c ? { ...c, title: l.title } : c)),
      onTodoUpsert: upsert,
      onTodoDelete: remove,
      onMemberUpsert: (m) => setMembers((x) => new Map(x).set(m.id, m)),
      onMemberDelete: (id) => setMembers((x) => { if (!x.has(id)) return x; const n = new Map(x); n.delete(id); return n; }),
      onRoleChange: (role) => setList((c) => (c ? { ...c, role } : c)),
      onAccessRevoked: () => { unsub(); leave(); },
      onListDeleted: () => { unsub(); leave(); },
      onStatus: (st: ChannelStatus) => {
        setLive(st === "SUBSCRIBED");
        if (st !== "SUBSCRIBED") { wasDown = true; return; }
        void refresh(!first && wasDown);
        first = false;
        wasDown = false;
      },
    });
    return unsub;
  }, [db, listId, router, leave, upsert, remove]);

  const canEdit = list?.role === "owner" || list?.role === "editor";
  const sorted = useMemo(() => [...todos.values()].sort(byOrder), [todos]);

  function fail(e: AppError) {
    setError(e.kind === "Forbidden" ? "You no longer have permission to edit this list." : e.message);
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError("");
    const r = await addTodo(db, listId, title);
    if (!r.ok) return fail(r.error);
    upsert(r.data);
    setTitle("");
  }

  // Rule 7: optimistic edit keeps the last server updatedAt; revert on error.
  function optimistic(t: Todo, next: Todo, call: Promise<{ ok: true; data: Todo } | { ok: false; error: AppError }>) {
    setError("");
    setTodos((m) => new Map(m).set(t.id, next));
    void call.then((r) => {
      if (r.ok) upsert(r.data);
      else { setTodos((m) => (m.has(t.id) ? new Map(m).set(t.id, t) : m)); fail(r.error); }
    });
  }
  const onToggle = (t: Todo, done: boolean) => optimistic(t, { ...t, done }, toggleTodo(db, t.id, done));
  const onRename = (t: Todo, name: string) => optimistic(t, { ...t, title: name }, updateTodo(db, t.id, { title: name }));

  async function onDelete(t: Todo) {
    setError("");
    setTodos((m) => { const n = new Map(m); n.delete(t.id); return n; });
    const r = await deleteTodo(db, t.id);
    if (r.ok) deleted.current.add(t.id);
    else { setTodos((m) => new Map(m).set(t.id, t)); fail(r.error); }
  }

  function closeShare() {
    setShareOpen(false);
    shareBtn.current?.focus();
  }

  if (!list) {
    return <main className="container">{error ? <p role="alert" className={s.error}>{error}</p> : <p className={s.muted}>Loading...</p>}</main>;
  }

  return (
    <main className="container">
      <p><Link href="/lists">&larr; All lists</Link></p>
      <div className={s.between}>
        <h1>{list.title}</h1>
        <span className={s.row}>
          <span className={s.badge}>{list.role}</span>
          <span className={s.live} role="status"><span className={`${s.dot} ${live ? s.dotOn : ""}`} />{live ? "Live" : "Connecting..."}</span>
          {list.role === "owner" && (
            <button ref={shareBtn} type="button" onClick={() => setShareOpen(true)}>Share</button>
          )}
        </span>
      </div>
      {!canEdit && <p className={s.muted}>You have view-only access to this list.</p>}
      {canEdit && (
        <form onSubmit={onAdd} className={s.row}>
          <label htmlFor="new-todo" style={{ position: "absolute", left: "-9999px" }}>New todo</label>
          <input id="new-todo" className={s.grow} placeholder="Add a todo" required maxLength={500}
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit">Add</button>
        </form>
      )}
      <div aria-live="polite">{error && <p role="alert" className={s.error}>{error}</p>}</div>
      {sorted.length === 0 ? <p className={s.muted}>No todos yet.</p> : (
        <ul className={s.list}>
          {sorted.map((t) => (
            <TodoItem key={t.id} todo={t} canEdit={!!canEdit} onToggle={onToggle} onRename={onRename} onDelete={onDelete} />
          ))}
        </ul>
      )}
      {list.role === "owner" && (
        <ShareDialog db={db} listId={listId} open={shareOpen} members={[...members.values()]}
          onClose={closeShare}
          onMemberUpsert={(m) => setMembers((x) => new Map(x).set(m.id, m))}
          onMemberRemove={(id) => setMembers((x) => { const n = new Map(x); n.delete(id); return n; })} />
      )}
    </main>
  );
}
