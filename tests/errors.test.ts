import { describe, it, expect } from "vitest";
import { mapPg } from "@/lib/lists/core";

// data-api.md "Other Postgres errors" + P0001 messages.
const table: [string, string, string, string?][] = [
  ["23505", "", "Conflict"],
  ["23503", "", "NotFound"],
  ["22P02", "", "NotFound"],
  ["23514", "new row violates check constraint \"todos_title_check\"", "InvalidInput"],
  ["23514", "new row violates check constraint \"list_members_email_check\"", "InvalidEmail"],
  ["42501", "", "Forbidden"],
  ["P0001", "not_found", "NotFound"],
  ["P0001", "forbidden", "Forbidden"],
  ["P0001", "conflict", "Conflict"],
  ["P0001", "something else", "Unknown"],
  ["XX000", "boom", "Unknown"],
  [undefined as unknown as string, "", "Unknown"],
];
describe("mapPg", () => {
  it.each(table)("code %s msg %j -> %s", (code, message, kind) => {
    expect(mapPg({ code, message }).kind).toBe(kind);
  });
  it("Unknown keeps the original error as cause", () => {
    const e = { code: "XX000", message: "boom" };
    expect(mapPg(e)).toMatchObject({ kind: "Unknown", message: "boom", cause: e });
  });
});
