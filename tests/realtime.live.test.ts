// NOT VERIFIED: contracts/realtime.md assumptions A1 and A2 need a live Realtime server.
// To run: start local Supabase (`supabase start`, migrations applied) or point at a test project, then
// create 3 real users (owner A, editor B, non-member C), build one supabase-js client per user, and replace
// the it.skip bodies below with the scenario from realtime.md "Verification tests". Never use production.
import { describe, it } from "vitest";

describe.skip("live Realtime (A1/A2) - requires real Supabase, not run in CI", () => {
  it.skip("A1: DELETE events are unfiltered and carry only the PK. A deletes a todo; C's onTodoDelete fires with the id only (firing confirms A1; not firing means DELETEs are filtered: safe, but report).", () => {});
  it.skip("A2: INSERT/UPDATE events reach members only. A addTodo -> B's onTodoUpsert fires within 5s; C receives none and its re-check fires onAccessRevoked.", () => {});
});
