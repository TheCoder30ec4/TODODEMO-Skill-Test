// Shared internals for @/lib/lists and @/lib/sharing: errors, validation, access gate, row mappers.
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type {
  AccessRole,
  AppError,
  List,
  ListMember,
  ListWithRole,
  Result,
  Role,
  Todo,
} from "@contracts/types";

export type Db = SupabaseClient;
export type PgError = { code?: string; message?: string; details?: string } | null;

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: AppError): { ok: false; error: AppError } => ({ ok: false, error });
const notFound = (message = "Not found") => fail({ kind: "NotFound", message });
const forbidden = () => fail({ kind: "Forbidden", message: "You do not have permission to do that" });

/** Maps a Postgres/PostgREST error to an AppError (data-api.md "Other Postgres errors"). */
export function mapPg(e: NonNullable<PgError>): AppError {
  const msg = e.message ?? "";
  switch (e.code) {
    case "23505":
      return { kind: "Conflict", message: "Already exists" };
    case "23503":
    case "22P02":
      return { kind: "NotFound", message: "Not found" };
    case "23514":
      return /email/i.test(`${msg} ${e.details ?? ""}`)
        ? { kind: "InvalidEmail", message: "Invalid email address" }
        : { kind: "InvalidInput", message: "Invalid input" };
    case "42501":
      return { kind: "Forbidden", message: "You do not have permission to do that" };
    case "P0001":
      if (msg === "not_found") return { kind: "NotFound", message: "Not found" };
      if (msg === "forbidden") return { kind: "Forbidden", message: "You do not have permission to do that" };
      if (msg === "conflict") return { kind: "Conflict", message: "Conflict, refetch and retry" };
  }
  return { kind: "Unknown", message: msg || "Unexpected error", cause: e };
}

/** Runs fn; any throw becomes Unknown. Every public function is wrapped in this. */
export async function guard<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (cause) {
    return fail({
      kind: "Unknown",
      message: cause instanceof Error ? cause.message : "Unexpected error",
      cause,
    });
  }
}

export async function requireUser(db: Db): Promise<Result<User>> {
  const { data, error } = await db.auth.getUser();
  if (error || !data?.user) return fail({ kind: "Unauthenticated", message: "Sign in required" });
  return ok(data.user);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

export function checkTitle(raw: string, max: number): Result<string> {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t || t.length > max) {
    return fail({ kind: "InvalidInput", message: `Title must be 1-${max} characters`, field: "title" });
  }
  return ok(t);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function checkEmail(raw: string): Result<string> {
  const e = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return EMAIL.test(e) ? ok(e) : fail({ kind: "InvalidEmail", message: "Invalid email address" });
}

export function checkRole(role: unknown): Result<Role> {
  return role === "viewer" || role === "editor"
    ? ok(role)
    : fail({ kind: "InvalidInput", message: "Role must be viewer or editor", field: "role" });
}

// ---- row mappers (snake_case row -> camelCase contract type) ----
type Row = Record<string, unknown>;

export const toList = (r: Row): List => ({
  id: r.id as string,
  ownerId: r.owner_id as string,
  title: r.title as string,
  createdAt: r.created_at as string,
});

export const toListWithRole = (r: Row): ListWithRole => ({
  ...toList(r),
  role: r.my_role as AccessRole,
  memberId: (r.my_member_id as string | null) ?? null,
});

export const toTodo = (r: Row): Todo => ({
  id: r.id as string,
  listId: r.list_id as string,
  title: r.title as string,
  done: r.done as boolean,
  position: r.position as number,
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export const toMember = (r: Row): ListMember => ({
  id: r.id as string,
  listId: r.list_id as string,
  email: r.email as string,
  role: r.role as Role,
  addedBy: (r.added_by as string | null) ?? null,
  createdAt: r.created_at as string,
});

// ---- access gate (data-api.md) ----
const RANK: Record<AccessRole, number> = { viewer: 1, editor: 2, owner: 3 };
export const SELECT_WITH_ROLE = "*, my_role, my_member_id";

/** Step 2: resolve the caller's access. No row or NULL my_role = NotFound. */
async function resolveAccess(db: Db, listId: string): Promise<Result<ListWithRole>> {
  const { data, error } = await db
    .from("lists")
    .select(SELECT_WITH_ROLE)
    .eq("id", listId)
    .maybeSingle();
  if (error) return fail(mapPg(error));
  if (!data || !(data as Row).my_role) return notFound();
  return ok(toListWithRole(data as Row));
}

/** Steps 2-3: NotFound if not visible, Forbidden if role is below `required`. */
export async function gate(db: Db, listId: string, required: AccessRole): Promise<Result<ListWithRole>> {
  if (!isUuid(listId)) return notFound();
  const access = await resolveAccess(db, listId);
  if (!access.ok) return access;
  return RANK[access.data.role] >= RANK[required] ? access : forbidden();
}

/** Resolves a todo's list_id (RLS hides todos of unreadable lists). */
export async function listIdOfTodo(db: Db, todoId: string): Promise<Result<string>> {
  if (!isUuid(todoId)) return notFound();
  const { data, error } = await db.from("todos").select("list_id").eq("id", todoId).maybeSingle();
  if (error) return fail(mapPg(error));
  return data ? ok((data as Row).list_id as string) : notFound();
}

/**
 * Step 4: run a write that returns rows (`.select()` chained). 0 rows or 42501 re-checks access once:
 * not visible = NotFound, insufficient = Forbidden, otherwise the target is gone = NotFound.
 */
export async function runGated<T>(
  db: Db,
  listId: string,
  required: AccessRole,
  op: () => PromiseLike<{ data: Row[] | null; error: PgError }>,
  map: (r: Row) => T,
): Promise<Result<T>> {
  const { data, error } = await op();
  if (!error && data && data.length > 0) return ok(map(data[0]));
  if (error && error.code !== "42501") return fail(mapPg(error));
  const again = await gate(db, listId, required);
  return again.ok ? notFound() : again;
}
