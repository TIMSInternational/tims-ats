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

| # | Check | Command |
|---|-------|---------|
| 1 | Type check API | `pnpm --filter @tims/api exec tsc --noEmit` |
| 2 | Type check Web | `cd apps/web && npx tsc --noEmit` |
| 3 | Tests (vitest) | `npx vitest run` (expect 103 passing as of 2026-06-06; more is fine, fewer is a failure) |
| 4 | No `any` in frontend | `grep -rn ": any\b" apps/web/app/ --include="*.tsx" --include="*.ts" \| grep -v node_modules \| grep -v ".test."` → must be empty |
| 5 | No unsafe SQL | `grep -rn 'executeRawUnsafe\|queryRawUnsafe' packages/api/src/ --include="*.ts"` → must be empty |
| 6 | No XSS patterns | `grep -rn 'dangerouslySetInnerHTML' apps/web/ --include="*.tsx" --include="*.ts" \| grep -v node_modules` → must be empty |
| 7 | No ts-ignore | `grep -rn '@ts-ignore\|@ts-nocheck' packages/ apps/web/app/ apps/web/lib/ apps/web/components/ --include="*.ts" --include="*.tsx" \| grep -v node_modules` → must be empty |
| 8 | No eval | `grep -rn '\beval\s*(' packages/ apps/web/ --include="*.ts" --include="*.tsx" \| grep -v node_modules \| grep -v ".test."` → must be empty |
| 9 | No service_role client-side | `grep -rn 'service_role' apps/web/app/ apps/web/components/ apps/web/lib/ --include="*.ts" --include="*.tsx" \| grep -v node_modules \| grep -v ".test."` → must be empty |
| 10 | AI single door (rule #2) | `grep -rn "@ai-sdk\|createAmazonBedrock\|bedrockGenerate\|from 'ai'\|from \"ai\"" packages apps --include="*.ts" --include="*.tsx" \| grep -v node_modules \| grep -v "packages/ai/"` → must be empty |
| 11 | Build | `SKIP_ENV_VALIDATION=true pnpm --filter @tims/web build` |
| 12 | Secret scan | `gitleaks git --no-banner .` (full history, same as CI) |

Notes:
- Run greps 4–10 together in one Bash call — they are fast and independent.
- Build (11) and tests (3) are the slow checks; run them last and in the background if you want to keep working, but the gate is NOT complete until they finish.

## Output

End with a table: check name → ✅ PASS / ❌ FAIL (+ one-line reason for failures). Then a single verdict line: **GATE PASSED** or **GATE FAILED (n checks)**.
