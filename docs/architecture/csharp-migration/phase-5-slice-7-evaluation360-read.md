# Phase 5 Slice 7 — Evaluation360 READ surface → C# (strangler domain #5, dark)

**Status:** SHIPPED-pending-merge (built + gated; 3 reviews GO, integration 453/0) · **Branch:** `feat/csharp-phase5-evaluation360-read`
**Flag:** `Platform:Evaluation360ReadEnabled` (default `false`) · **Cutover:** deferred (Federico)
**Ledger:** `efcoreReadOnly` (reads over Prisma-owned tables; NO flip, NO new tables)

## Why this slice
FIFTH strangler domain. Two firsts: (1) reuses the **already-ported `Eval360Aggregate.Aggregate360Report`
kernel** (`Tims.Domain/Access/Eval360Aggregate.cs`, Phase-1 Spike B) for the anonymized report — no re-port;
(2) introduces the **first identity-anchored self-service READ pattern** in C# (protectedProcedure, no RBAC
grant, no scope — hard-filtered on the caller's own user id). It also exercises the familiar staff org-gate.

## Source surface (spec = live TS `packages/api/src/routers/evaluation360.ts` + service + aggregate)
Read the router's header docstring (lines 32–60) — it precisely states the auth intent for each path. Service:
`packages/api/src/services/evaluation360.service.ts`; repo: `…/repositories/evaluation360.repository.ts`;
pure aggregate: `…/services/evaluation360-aggregate.ts` (`aggregate360Report`, `MIN_360_BUCKET_SIZE=3`).
Tables: `review_cycles`, `rater_assignments`, `rater_responses`.

| # | Read | Auth pattern | Body |
|---|------|--------------|------|
| 1 | `listCycles` | **staff**: `evaluation360:read` + `requireOrgScope` (narrow→403, F3) | org's review cycles |
| 2 | `getCycleProgress({cycleId})` | **staff**: same | per-relationship submitted/total progress for a cycle |
| 3 | `myRaterTasks` | **self-service** (`protectedProcedure`): identity-anchored on `ctx.user.id` as RATER | the caller's assigned rating tasks |
| 4 | `myReport({cycleId})` | **self-service**: identity-anchored on `ctx.user.id` as SUBJECT | the caller's anonymized report (min-3 aggregate) |
| 5 | `myReportCycles` | **self-service**: identity-anchored on `ctx.user.id` as SUBJECT | published cycles the caller is a subject of |

## Auth — TWO patterns, do NOT cross them (the router docstring is the authority)
**Staff (reads 1–2):** C# analog of `permissionProcedure('evaluation360','read')` THEN `requireOrgScope`. Mirror
`ReportingStaffGate` exactly but grant = `evaluation360:read`; apply `OrgGate.RequireOrgScopeSatisfied` → 403 on
narrow team/unit/own (F3). Unresolved→401.

**Self-service (reads 3–5) — NEW C# pattern, spec carefully:** C# analog of `protectedProcedure` — authorization
is IDENTITY, not a grant. Resolve the staff principal (`PrincipalResolver`); a valid resolved principal is
sufficient (NO `evaluation360:read` grant required — any assigned rater/subject, e.g. a leader with no eval grant,
must succeed). Then **hard-filter every query on the resolved `principal.UserId`** — `raterUserId = principal.UserId`
for read 3, `subjectUserId = principal.UserId` for reads 4–5. **MUST NOT** call the org-gate, `AssertScoped`, or
`ScopeWhereFor**: for an org-scoped admin those degrade to match-all and would let them read/forge on behalf of
another user. There is NO id param for the subject/rater — it is ALWAYS the caller. Unresolved principal→401.
(This is exactly why `raterAssignment` is deliberately NOT a `ScopedEntity`.)

## Kernel reuse (do NOT re-port)
`myReport` aggregation = `Eval360Aggregate.Aggregate360Report(rows)` (already in C#, records `AggregateInputRow`/
`CompetencyAverage`/`ReportBucket` match the TS `aggregate360Report`). Wire: EF-read the cycle's responses for the
subject → map to `AggregateInputRow` → call the kernel → return buckets. **min-3 suppress-by-omission**
(`MIN_360_BUCKET_SIZE=3`): a relationship bucket with <3 raters is OMITTED (not shown as N/D). Gate before
aggregating: cycle `status==='published'` AND the caller is a subject of the cycle — else **404 NOT_FOUND**
(both gates map to 404, matching the TS which throws NOT_FOUND; NOT an empty report body). Golden-fixture the kernel BOTH stacks if not already (Phase-1 fixtures may cover it — verify + extend).

## Data plane (EF, read-only)
`Tims.Infrastructure/Evaluation360/` read-only (`AsNoTracking`) over `review_cycles`, `rater_assignments`,
`rater_responses` (+ `users` for rater/subject names if the TS output includes them — verify each DTO) under
`TenantScope`/RLS + explicit `organizationId`. Self-service reads additionally hard-filter on `principal.UserId`
(defense-in-depth atop RLS). `efcoreReadOnly += review_cycles, rater_assignments, rater_responses`. No flip, no new tables.
Shapes = RAW model shape, no `schemaVersion` (INTERNAL). Match each tRPC output field-for-field (dates → the
NodeIsoDateTimeOffsetConverter / epoch pattern per prior slices; verify against the TS service return types).

## Endpoints (dark behind `Platform:Evaluation360ReadEnabled`; build-only OpenAPI)
- Staff: `GET /evaluation360/cycles` (listCycles), `GET /evaluation360/cycles/{cycleId}/progress` (getCycleProgress)
  — `Evaluation360StaffGate` (grant + OrgGate).
- Self-service: `GET /evaluation360/my/rater-tasks`, `GET /evaluation360/my/reports/{cycleId}`,
  `GET /evaluation360/my/report-cycles` — `Evaluation360SelfServiceGate` (resolve principal → 401 if none; NO grant,
  NO scope) → hard-filter on `principal.UserId`. Semantic input validation runs AFTER auth; note the route
  template constraint `{cycleId:guid}` rejects a malformed GUID at ROUTING (404) before the handler/auth — an
  accepted trade (a malformed id can't identify a real resource anyway).

## Regression corpus (bite-proven, Testcontainers on real RLS)
- **F3 org-gate** on listCycles/getCycleProgress: narrow team/unit/own `evaluation360:read` → 403; use VALID staff
  slugs (the #150 lesson — dropped slugs = false-green).
- **Identity-anchoring** (the critical one): user A's my-* returns ONLY A's rater tasks / A's report / A's cycles;
  an org-admin CANNOT obtain another user's data (no id param; anchored on caller) — bite: seed rater B's tasks,
  assert A's call never returns them; neutralize the `UserId` hard-filter → the test flips.
- **No-grant self-service**: a rater with NO `evaluation360` grant still gets their tasks/report (protectedProcedure).
- **min-3 anonymity**: a relationship bucket with <3 responses is OMITTED from myReport (suppress-by-omission);
  published-only gate (draft/open/closed cycle → 404 NOT_FOUND); non-subject caller → 404 NOT_FOUND.
- Auth matrix (WebApplicationFactory): staff grant→403 / narrow→403 / JWT→401; self-service JWT→401; dark→404.

## Gate (agent-driven SDD)
3 adversarial reviews (security/auth + correctness/parity + Codex) all GO no Crit/High/Med → fix in-branch
bite-proven → Codex recheck PASS → PR → admin-merge past CI billing trap. Local gate from `services/Tims.Platform`:
build 0-warn · format · unit + integration (Docker) · from root `node scripts/table-ownership.mjs`; TS touched (if a
kernel golden is extended) → api/web tsc + vitest.

## FE cutover (separate step after merge, dark)
5 gate wrappers, one flag `NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP` (mirrors `Platform:Evaluation360ReadEnabled`):
`talent/360/page.tsx` (listCycles), `talent/360/cycle-progress-panel.tsx` (getCycleProgress),
`my-360/my-tasks-section.tsx` (myRaterTasks), `my-360/cycle-report-card.tsx` (myReport),
`my-360/my-report-section.tsx` (myReportCycles).
