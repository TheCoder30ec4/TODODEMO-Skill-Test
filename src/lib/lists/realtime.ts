// Implements contracts/realtime.md: one channel `list:{listId}`, 8 postgres_changes subscriptions.
import type { AppError, ChannelStatus, ListSubscriptionHandlers, Unsubscribe } from "@contracts/types";
import { type Db, isUuid, toList, toMember, toTodo } from "./core";

type Row = Record<string, unknown>;
type Payload = { new: Row; old: Row };

export function subscribeToList(db: Db, listId: string, handlers: ListSubscriptionHandlers): Unsubscribe {
  if (!isUuid(listId)) {
    queueMicrotask(() => handlers.onAccessRevoked?.());
    return () => {};
  }
  let ownMemberId: string | null = null;
  let closed = false;
  // Handler exceptions must not break the channel callback.
  const safe = (fn: () => void) => {
    if (closed) return;
    try {
      fn();
    } catch {
      /* ponytail: swallow UI handler errors */
    }
  };

  // Runs on every SUBSCRIBED (first and reconnects): learn own member id, detect lost access.
  const recheck = async () => {
    try {
      const { data, error } = await db
        .from("lists")
        .select("my_role, my_member_id")
        .eq("id", listId)
        .maybeSingle();
      if (error) return; // transient; do not report a revocation we did not observe
      if (!data || !data.my_role) return safe(() => handlers.onAccessRevoked?.());
      ownMemberId = (data.my_member_id as string | null) ?? null;
    } catch {
      /* ignore */
    }
  };

  const on = (table: string, event: "INSERT" | "UPDATE" | "DELETE", filter: string | undefined, cb: (p: Payload) => void) => {
    const cfg = { event, schema: "public", table, ...(filter ? { filter } : {}) };
    channel.on("postgres_changes", cfg, (p: Payload) => safe(() => cb(p)));
  };

  const channel = db.channel(`list:${listId}`);
  const byList = `list_id=eq.${listId}`;
  on("lists", "UPDATE", `id=eq.${listId}`, (p) => handlers.onListUpdate?.(toList(p.new)));
  on("lists", "DELETE", undefined, (p) => {
    if (p.old.id === listId) handlers.onListDeleted?.();
  });
  on("todos", "INSERT", byList, (p) => handlers.onTodoUpsert?.(toTodo(p.new)));
  on("todos", "UPDATE", byList, (p) => handlers.onTodoUpsert?.(toTodo(p.new)));
  on("todos", "DELETE", undefined, (p) => handlers.onTodoDelete?.(p.old.id as string));
  on("list_members", "INSERT", byList, (p) => handlers.onMemberUpsert?.(toMember(p.new)));
  on("list_members", "UPDATE", byList, (p) => {
    const m = toMember(p.new);
    handlers.onMemberUpsert?.(m);
    if (ownMemberId !== null && m.id === ownMemberId) handlers.onRoleChange?.(m.role);
  });
  on("list_members", "DELETE", undefined, (p) => {
    const id = p.old.id as string;
    handlers.onMemberDelete?.(id);
    if (ownMemberId !== null && id === ownMemberId) handlers.onAccessRevoked?.();
  });

  channel.subscribe((status: string, err?: Error) => {
    if (closed) return;
    const s = status as ChannelStatus;
    const error: AppError | undefined = err ? { kind: "Unknown", message: err.message, cause: err } : undefined;
    safe(() => handlers.onStatus?.(s, error));
    if (s === "SUBSCRIBED") void recheck();
  });

  return () => {
    if (closed) return;
    closed = true;
    void Promise.resolve(db.removeChannel(channel)).catch(() => {});
  };
}
