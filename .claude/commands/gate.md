---
description: Run the full local verify gate (tsc api+web, vitest, code-quality greps, build, gitleaks) and report pass/fail per check
allowed-tools:
  - Bash
---

# /gate — Local Verify Gate

Run every check the CI pipeline runs, locally, from the repo root. Report a pass/fail table at the end. This is the merge gate when GitHub Actions is unavailable, and the pre-push gate when it isn't.

## Execution Contract (non-negotiable)

You MUST run ALL checks below even if an early one fails — the user needs the full picture, not the first failure. You are forbidden from:

- Skipping any check ("it probably passes" is not a result)
- Declaring the gate passed without showing each command's actual outcome
- "Fixing" failures silently inside this command — report them; fixing is a separate decision
- Running checks from any directory other than the repo root (except where a check specifies `cd`)

**Fail-closed guardrail**: if a check cannot run at all (missing binary, install error), treat it as FAILED, stop after completing the remaining runnable checks, and report. Do not improvise substitutes.

## Checks (mirror of .github/workflows/ci.yml)

Run prisma generate once first (typecheck/tests/build all need the client):

```bash
pnpm --filter @tims/db exec prisma generate --schema prisma/schema
```

| #   | Check                          | Command                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Type check API                 | `pnpm --filter @tims/api exec tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                                   |
| 2   | Type check Web                 | `cd apps/web && npx tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | Tests (vitest)                 | `npx vitest run` (expect **2635 passing across 283 files** as of 2026-08-03; more is fine, fewer is a failure). Bump this when you add tests — a stale anchor makes "fewer is a failure" unenforceable, the same defect class as a gate that cannot fail.                                                                                                                                                                                                                                                                                                                      |
| 4   | No `any` in frontend           | `grep -rn ": any\b" apps/web/app/ --include="*.tsx" --include="*.ts" \| grep -v node_modules \| grep -v ".test."` → must be empty                                                                                                                                                                                                                                                                             |
| 5   | No unsafe SQL                  | `grep -rn 'executeRawUnsafe\|queryRawUnsafe' packages/api/src/ --include="*.ts"` → must be empty                                                                                                                                                                                                                                                                                                              |
| 6   | No XSS patterns                | `grep -rn 'dangerouslySetInnerHTML' apps/web/ --include="*.tsx" --include="*.ts" \| grep -v node_modules` → must be empty                                                                                                                                                                                                                                                                                     |
| 7   | No ts-ignore                   | `grep -rn '@ts-ignore\|@ts-nocheck' packages/ apps/web/app/ apps/web/lib/ apps/web/components/ --include="*.ts" --include="*.tsx" \| grep -v node_modules` → must be empty                                                                                                                                                                                                                                    |
| 8   | No eval                        | `grep -rn '\beval\s*(' packages/ apps/web/ --include="*.ts" --include="*.tsx" \| grep -v node_modules \| grep -v ".test."` → must be empty                                                                                                                                                                                                                                                                    |
| 9   | No service_role client-side    | `grep -rn 'service_role' apps/web/app/ apps/web/components/ apps/web/lib/ --include="*.ts" --include="*.tsx" \| grep -v node_modules \| grep -v ".test."` → must be empty                                                                                                                                                                                                                                     |
| 10  | AI single door (rule #2)       | `grep -rn "@ai-sdk\|createAmazonBedrock\|bedrockGenerate\|from 'ai'\|from \"ai\"" packages apps --include="*.ts" --include="*.tsx" \| grep -v node_modules \| grep -v "packages/ai/"` → must be empty                                                                                                                                                                                                         |
| 11  | Build                          | `SKIP_ENV_VALIDATION=true pnpm --filter @tims/web build`                                                                                                                                                                                                                                                                                                                                                      |
| 12  | Secret scan                    | `gitleaks git --no-banner .` (full history, same as CI)                                                                                                                                                                                                                                                                                                                                                       |
| 13  | Scope AND-composition          | `grep -rn '\.\.\.[[:alnum:]_$.]*access\.where\|\.\.\.[[:alnum:]_$.]*scopeWhere' packages/api/src --include="*.ts"` → must be empty                                                                                                                                                                                                                                                                            |
| 14  | RLS tenant isolation (live DB) | `npx tsx scripts/security/verify-rls-isolation.ts` → exit 0. Auto-loads `packages/db/.env`; needs the **session pooler** (:5432 — :6543 cannot `SET LOCAL ROLE`). If credentials are broken, run `bash scripts/dev/setup-db-env.sh` (#41). If no DB is reachable, report this check as ⚠️ SKIPPED with the reason — never as PASS.                                                                            |
| 15  | Cross-model review             | `bash scripts/verification/crossmodel-review.sh` → exit 0. Tries Codex, then OmniRoute (tier 2). **Exit 2 = NO reviewer ran** — report ⚠️ NOT RUN, never PASS, then use the same-model 3-lens panel in `.claude/rules/verification.md`. Codex is quota-blocked until 2026-08-15; set `OMNIROUTE_KEY` to make tier 2 live.                                                                                     |
| 16  | Schema drift (live DB)         | `bash scripts/db/schema-baseline.sh check` → exit 0. Diffs the live schema against `packages/db/baseline/prod-public-schema.sql`. Needs the direct connection (:5432) and `pg_dump` ≥ 17 (`brew install postgresql@17`). **Exit 1 = drift, exit 2 = COULD NOT RUN** — report ⚠️ NOT RUN, never PASS. If the PR intentionally changes the schema, re-run `capture` and commit the new baseline **in that PR**. |

Notes:

- Run greps 4–10 together in one Bash call — they are fast and independent.
- Build (11) and tests (3) are the slow checks; run them last and in the background if you want to keep working, but the gate is NOT complete until they finish.
- **Check 14 is a LIVE database check and cannot be replaced by a unit test.** Issue #111 found two policy
  families in production (`org_isolation` on 67 tables, `allow_all` on 9) that existed in **zero repo
  files** — applied out of band. Because Postgres ORs PERMISSIVE policies, both silently defeated the
  fail-closed `tenant_isolation` guard, and an unset org GUC returned every tenant's rows. No amount of
  static analysis over the repo's migrations would have caught it. Only querying the database does.
  A skipped check 14 means tenant isolation is unverified — say so plainly rather than letting the gate
  read green.
- **Checks 14 and 16 are different controls. Neither subsumes the other — do not skip one because the
  other is green** (#115):
  - **14 is functional/empirical.** It actually probes rows with the org GUC unset and asserts zero come
    back. It catches a fail-open policy _whatever_ its provenance, including one that has been in prod
    long enough to sit in the committed baseline.
  - **16 is structural.** It diffs the whole live schema against the committed baseline, so it catches
    change classes 14 never looks at — a dropped constraint, an added column, a missing GRANT — and it
    does so regardless of which of the four DDL paths made the change. That includes Supabase dashboard
    _table-editor_ edits, which leave no row in `supabase_migrations` and are invisible to any
    provenance audit. One such column is already in production: `nine_box_evaluations.updated_at`
    is created by no Prisma model, no migration file, no manual SQL and no EF migration, and is
    recorded in none of the three migration-history tables. (The committed baseline now records that
    it EXISTS — that is the baseline doing its job. Nothing explains how it got there.)
  - **The blind spot 16 has by construction:** anything already present when the baseline was captured
    is, by definition, "no drift". 16 tells you _the schema has not changed_, never _the schema is
    correct_. Correctness assertions live in 14.
- **Never make check 16 green by re-capturing a baseline you have not read.** The whole value is that
  someone looks at the hunk. A reflexive `capture` turns the control into a rubber stamp — and because
  16 is trust-on-human-review, that is its realistic failure mode, not a hypothetical one.
- **Check 16 is local-only today**, so it runs when `/gate` runs, not on every push. It needs the direct
  connection and a `pg_dump` ≥ 17; wiring prod credentials into CI is deferred (#124). If it cannot run,
  report ⚠️ NOT RUN and do not merge a schema change behind it — see `ddl-governance.md` §5.

## Output

End with a table: check name → ✅ PASS / ❌ FAIL (+ one-line reason for failures). Then a single verdict line: **GATE PASSED** or **GATE FAILED (n checks)**.
