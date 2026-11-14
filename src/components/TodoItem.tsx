"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Todo } from "@contracts/types";
import s from "./ui.module.css";

interface Props {
  todo: Todo;
  canEdit: boolean;
  onToggle: (todo: Todo, done: boolean) => void;
  onRename: (todo: Todo, title: string) => void;
  onDelete: (todo: Todo) => void;
}

export default function TodoItem({ todo, canEdit, onToggle, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);
  const input = useRef<HTMLInputElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) input.current?.focus();
    else if (wasEditing.current) editBtn.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  // Viewer downgrade while editing closes the editor.
  const active = editing && canEdit;

  function save(e: FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    setEditing(false);
    if (t && t !== todo.title) onRename(todo, t);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") setEditing(false);
  }

  return (
    <li className={`${s.card} ${s.between}`}>
      {active ? (
        <form onSubmit={save} onKeyDown={onKey} className={`${s.row} ${s.grow}`}>
          <label htmlFor={`edit-${todo.id}`} style={{ position: "absolute", left: "-9999px" }}>Edit todo title</label>
          <input id={`edit-${todo.id}`} ref={input} className={s.grow} value={draft} maxLength={500}
            onChange={(e) => setDraft(e.target.value)} />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <>
          <label className={s.row}>
            <input type="checkbox" checked={todo.done} disabled={!canEdit}
              onChange={(e) => onToggle(todo, e.target.checked)} />
            <span className={todo.done ? s.done : undefined}>{todo.title}</span>
          </label>
          {canEdit && (
            <span className={s.row}>
              <button ref={editBtn} type="button" aria-label={`Edit ${todo.title}`}
                onClick={() => { setDraft(todo.title); setEditing(true); }}>Edit</button>
              <button type="button" aria-label={`Delete ${todo.title}`} onClick={() => onDelete(todo)}>Delete</button>
            </span>
          )}
        </>
      )}
    </li>
  );
}
