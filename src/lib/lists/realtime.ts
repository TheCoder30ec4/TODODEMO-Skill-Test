// Implements contracts/realtime.md: one channel per subscription, 8 postgres_changes subscriptions.
// Assumptions A1 (DELETE unfiltered, id only) and A2 (RLS on INSERT/UPDATE events) in realtime.md
// "Assumptions to verify" are NOT verified here (needs live Realtime); handed to the qa task.
// Channel name is `list:{listId}:{n}` (unique per call): realtime-js reuses a channel by name, and a
// channel still leaving would throw on `.on()` after subscribe (StrictMode / quick remount).
import type { AppError, ChannelStatus, ListSubscriptionHandlers, Unsubscribe } from "@contracts/types";
import { type Db, isUuid, toList, toMember, toTodo } from "./core";

type Row = Record<string, unknown>;
type Payload = { new: Row; old: Row };

let seq = 0; // module-level monotonic counter

const toAppError = (cause: unknown): AppError => ({
  kind: "Unknown",
  message: cause instanceof Error ? cause.message : "Realtime error",
  cause,
});

export function subscribeToList(db: Db, listId: string, handlers: ListSubscriptionHandlers): Unsubscribe {
  let closed = false;
  let channel: ReturnType<Db["channel"]> | undefined;
  // Nothing fires after unsubscribe; handler exceptions never break the channel callback.
  const safe = (fn: () => void) => {
    if (closed) return;
    try {
      fn();
    } catch {
      /* ponytail: swallow UI handler errors */
    }
  };
  const unsubscribe: Unsubscribe = () => {
    if (closed) return;
    closed = true;
    if (channel) void Promise.resolve(db.removeChannel(channel)).catch(() => {});
  };

  if (!isUuid(listId)) {
    queueMicrotask(() => safe(() => handlers.onAccessRevoked?.()));
    return unsubscribe;
  }

  let ownMemberId: string | null = null;

  // Runs on every SUBSCRIBED (first and reconnects): learn own member id, detect lost access.
  const recheck = async () => {
    try {
      const { data, error } = await db
        .from("lists")
        .select("my_role, my_member_id")
        .eq("id", listId)
        .maybeSingle();
      if (error) {
        return safe(() => handlers.onStatus?.("CHANNEL_ERROR", toAppError(error)));
      }
      if (!data || !data.my_role) return safe(() => handlers.onAccessRevoked?.());
      ownMemberId = (data.my_member_id as string | null) ?? null;
    } catch (e) {
      safe(() => handlers.onStatus?.("CHANNEL_ERROR", toAppError(e)));
    }
  };

  try {
    const ch = db.channel(`list:${listId}:${++seq}`);
    channel = ch;
    const on = (table: string, event: "INSERT" | "UPDATE" | "DELETE", filter: string | undefined, cb: (p: Payload) => void) => {
      const cfg = { event, schema: "public", table, ...(filter ? { filter } : {}) };
      ch.on("postgres_changes", cfg, (p: Payload) => safe(() => cb(p)));
    };
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

    ch.subscribe((status: string, err?: Error) => {
      if (closed) return;
      const s = status as ChannelStatus;
      safe(() => handlers.onStatus?.(s, err ? toAppError(err) : undefined));
      if (s === "SUBSCRIBED") void recheck();
    });
  } catch (e) {
    // Failures go through onStatus, never thrown (async so the caller has the Unsubscribe first).
    queueMicrotask(() => safe(() => handlers.onStatus?.("CHANNEL_ERROR", toAppError(e))));
  }

  return unsubscribe;
}
