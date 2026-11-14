// Deterministic fake Supabase client. No network. Responses are queued per table (or per rpc name).
import type { SupabaseClient } from "@supabase/supabase-js";

export type Resp = { data?: unknown; error?: { code?: string; message?: string } | null };
type RespFn = Resp | ((call: Call) => Resp);
export type Call = { table: string; ops: [string, unknown[]][] };

export const UID = "00000000-0000-4000-8000-000000000001";
export const LIST = "11111111-1111-4111-8111-111111111111";
export const TODO = "22222222-2222-4222-8222-222222222222";
export const MEMBER = "33333333-3333-4333-8333-333333333333";
export const OTHER = "44444444-4444-4444-8444-444444444444";

export const listRow = (role: string | null, extra: Record<string, unknown> = {}) => ({
  id: LIST, owner_id: UID, title: "L", created_at: "2025-01-01T00:00:00Z",
  my_role: role, my_member_id: role === "owner" ? null : MEMBER, ...extra,
});
export const todoRow = (extra: Record<string, unknown> = {}) => ({
  id: TODO, list_id: LIST, title: "T", done: false, position: 0, created_by: UID,
  created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z", ...extra,
});
export const memberRow = (extra: Record<string, unknown> = {}) => ({
  id: MEMBER, list_id: LIST, email: "a@b.co", role: "viewer", added_by: UID,
  created_at: "2025-01-01T00:00:00Z", ...extra,
});

export type FakeChannel = ReturnType<typeof makeChannel>;
function makeChannel(name: string, opts: { onThrows?: boolean; subscribeThrows?: boolean }) {
  const regs: { cfg: { event: string; table: string; filter?: string }; cb: (p: unknown) => void }[] = [];
  let statusCb: ((s: string, e?: Error) => void) | undefined;
  const ch = {
    name, regs,
    on(_type: string, cfg: { event: string; table: string; filter?: string }, cb: (p: unknown) => void) {
      if (opts.onThrows) throw new Error("cannot add postgres_changes callbacks after subscribe()");
      regs.push({ cfg, cb });
      return ch;
    },
    subscribe(cb: (s: string, e?: Error) => void) {
      if (opts.subscribeThrows) throw new Error("subscribe boom");
      statusCb = cb;
      return ch;
    },
    status: (s: string, e?: Error) => statusCb?.(s, e),
    emit(table: string, event: string, payload: { new?: unknown; old?: unknown }) {
      for (const r of regs) {
        if (r.cfg.table === table && r.cfg.event === event) r.cb({ new: {}, old: {}, ...payload });
      }
    },
  };
  return ch;
}

export function fakeDb(opts: {
  user?: { id: string; email?: string } | null;
  authError?: { name?: string; message: string } | null;
  getUserThrows?: boolean;
  channelThrows?: boolean; // db.channel() itself throws
  onThrows?: boolean;
  subscribeThrows?: boolean;
} = {}) {
  const queues = new Map<string, RespFn[]>();
  const calls: Call[] = [];
  const channels: FakeChannel[] = [];
  const removed: unknown[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const user = opts.user === undefined ? { id: UID, email: "owner@x.co" } : opts.user;

  const next = (key: string, call: Call): Resp => {
    const q = queues.get(key);
    const r = q?.length ? q.shift()! : { data: null, error: null };
    const v = typeof r === "function" ? r(call) : r;
    return { data: v.data ?? null, error: v.error ?? null };
  };

  const db = {
    auth: {
      getUser: async () => {
        if (opts.getUserThrows) throw new Error("getUser exploded");
        if (user) return { data: { user }, error: null };
        return { data: { user: null }, error: opts.authError ?? null };
      },
    },
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "delete", "eq", "order", "limit", "maybeSingle", "single"]) {
        b[m] = (...args: unknown[]) => { call.ops.push([m, args]); return b; };
      }
      b.then = (res: (v: Resp) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(next(table, call)).then(res, rej);
      return b;
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return next(`rpc:${fn}`, { table: `rpc:${fn}`, ops: [] });
    },
    channel(name: string) {
      if (opts.channelThrows) throw new Error("channel boom");
      const ch = makeChannel(name, opts);
      channels.push(ch);
      return ch;
    },
    removeChannel: async (ch: unknown) => { removed.push(ch); return "ok"; },
  };

  return {
    db: db as unknown as SupabaseClient,
    calls, channels, removed, rpcCalls,
    /** Queue responses for `from(table)` (or `rpc:name`), consumed in order. */
    queue(key: string, ...rs: RespFn[]) { queues.set(key, [...(queues.get(key) ?? []), ...rs]); return this; },
    /** Calls made to a table, in order. */
    on: (table: string) => calls.filter((c) => c.table === table),
  };
}
export const opNames = (c: Call) => c.ops.map((o) => o[0]);
