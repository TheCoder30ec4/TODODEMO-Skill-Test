# Contributing

## Pull request flow

- One branch per task; keep PRs small and focused.
- Open a PR against `main`. `main` is protected: no direct pushes.
- The CI job `ci` (install, lint, typecheck, build, tests on Node 22) runs on every PR and should pass. It becomes a required check once the gate is applied; today the ruleset requires only `orch/review`.
- An independent review sets the `orch/review` status; it must be green before merge.
- Merge with squash.

## Checks before pushing

```sh
npm ci
npm run lint && npm run typecheck
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-dummy npm run build
npm test
```

Use Node 22. Never commit real secrets; `.env.local` is for local values only.

## Commit authorship

Commits may be authored by named agent identities (for example "Dragonite repo-architect agent"). Each carries an `Orch-Task:` trailer naming the task it came from.
