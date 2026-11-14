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
  let subscribed = false;
  const ch = {
    name, regs,
    on(_type: string, cfg: { event: string; table: string; filter?: string }, cb: (p: unknown) => void) {
      if (opts.onThrows || subscribed) throw new Error(`cannot add postgres_changes callbacks for ${name} after subscribe()`);
      regs.push({ cfg, cb });
      return ch;
    },
    subscribe(cb: (s: string, e?: Error) => void) {
      if (opts.subscribeThrows) throw new Error("subscribe boom");
      statusCb = cb;
      subscribed = true;
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
  removeChannelRejects?: boolean;
} = {}) {
  const queues = new Map<string, RespFn[]>();
  const calls: Call[] = [];
  const channels: FakeChannel[] = []; // every distinct channel created
  const byName = new Map<string, FakeChannel>(); // live channels, like realtime-js reuse-by-name
  const removed: unknown[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const user = opts.user === undefined ? { id: UID, email: "owner@x.co" } : opts.user;

  const next = (key: string, call: Call): Resp => {
    const q = queues.get(key);
    if (!q?.length) throw new Error(`fakeDb: unexpected call (nothing queued) -> ${key}: ${chain(call)}`);
    const r = q.shift()!;
    const v = typeof r === "function" ? r(call) : r;
    // Like PostgREST: a write without a chained .select() returns no rows (data null).
    const names = call.ops.map((o) => o[0]);
    const isWrite = names.some((n) => n === "insert" || n === "update" || n === "delete");
    const returnsRows = names.includes("select") && names.indexOf("select") > Math.max(names.indexOf("insert"), names.indexOf("update"), names.indexOf("delete"));
    return { data: isWrite && !returnsRows ? null : (v.data ?? null), error: v.error ?? null };
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
      const existing = byName.get(name);
      if (existing) return existing; // realtime-js returns the existing channel for a reused name
      const ch = makeChannel(name, opts);
      channels.push(ch);
      byName.set(name, ch);
      return ch;
    },
    removeChannel: async (ch: FakeChannel) => {
      removed.push(ch);
      byName.delete(ch.name);
      if (opts.removeChannelRejects) throw new Error("remove failed");
      return "ok";
    },
  };

  return {
    db: db as unknown as SupabaseClient,
    calls, channels, removed, rpcCalls,
    /** Queue responses for `from(table)` (or `rpc:name`), consumed in order. */
    queue(key: string, ...rs: RespFn[]) { queues.set(key, [...(queues.get(key) ?? []), ...rs]); return this; },
    /** Full query chain of every call to a table, e.g. `update({"done":true}).eq("id","..").select()`. */
    chains: (table: string) => calls.filter((c) => c.table === table).map(chain),
    /** Throws unless every queued response was consumed. */
    assertDrained() {
      const left = [...queues].filter(([, q]) => q.length).map(([k, q]) => `${k}:${q.length}`);
      if (left.length) throw new Error(`fakeDb: unconsumed responses ${left.join(", ")}`);
    },
    /** Calls made to a table, in order. */
    on: (table: string) => calls.filter((c) => c.table === table),
  };
}
export const chain = (c: Call) =>
  c.ops.map(([m, a]) => `${m}(${a.map((x) => JSON.stringify(x)).join(",")})`).join(".");
export const GATE = `select("*, my_role, my_member_id").eq("id","${LIST}").maybeSingle()`;
export const TODO_LOOKUP = `select("list_id").eq("id","${TODO}").maybeSingle()`;
export const opNames = (c: Call) => c.ops.map((o) => o[0]);
