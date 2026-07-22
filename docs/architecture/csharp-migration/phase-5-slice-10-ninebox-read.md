# Phase 5 Slice 10 — Nine-Box READ surface → C# (strangler #8, dark)

**Status:** design (build pending) · **Branch:** `feat/csharp-phase5-ninebox-read`
**Flag:** `Platform:NineBoxReadEnabled` (default `false`) · **Cutover:** deferred (Federico)
**Ledger:** `efcoreReadOnly` (reads over Prisma-owned tables; NO flip, NO new tables)

## Why this slice
EIGHTH strangler domain. 11 reads, **NO min-5, NO FX, NO external dependency** → one coherent slice (contrast
compensation, split only for the live-FX blocker). Reuses warm infra: `nine_box_evaluations` is ALREADY in
`ScopeProbeRegistry.Tables` (registered in succession Slice-8, `userId`→`user_id`) and `ScopeWhereFor(NineBoxEvaluation)`
→ `SubjectAsync("userId")` already exists; `SubjectInScope`/`SelfServiceGuard` (assertSubjectInScope) + `OrgGate`
(requireOrgScope) reused. The one genuinely NEW element is the **calibration sub-domain** (3 read tables +
a hand-rolled created-by-OR-member auth — NOT a registered scope entity).

## Source surface (spec = live TS `packages/api/src/routers/ninebox.ts`)
Port the 11 READS; do NOT port the 6 writes (createCalibration / submitCalibrationVote / add-/removeCalibrationMember /
finalizeCalibration).

| # | Read | Auth / mechanic | Notes |
|---|------|-----------------|-------|
| 1 | `getGrid({period,teamId?,unitId?,companyId?})` | `scopeWhereFor('nineBoxEvaluation')` + input teamId/unitId/companyId INTERSECT filters | grid placement by quadrant (`quadrantToGrid`), order `evaluatedAt desc` |
| 2 | `getEmployeeDetail({userId,period})` | `assertSubjectInScope(userId)` | evaluation + cross-period history (order `evaluatedAt asc`) |
| 3 | `getAxisBreakdown({userId,period})` | `assertSubjectInScope(userId)` | findFirstOrThrow; returns scores/quadrant/confidence/axisBreakdown (jsonb) |
| 4 | `getMovementHistory({userId?,companyId?})` | `scopeWhereFor('nineBoxEvaluation')` + intersect filters | consecutive-quadrant-change computation per user (order `userId asc, evaluatedAt asc`) |
| 5 | `simulate({userId,newPotentialScore,newPerformanceScore})` | grant-only (PURE, no ctx) | band thresholds (≥67 high / ≥34 medium) → `simulateQuadrantMap`; `_stub:true` |
| 6 | `listCalibrations` | `requireOrgScope` (F3) | all org sessions, bounded 100, `_count.members` |
| 7 | `getCalibration({id})` | **MEMBERSHIP-auth** | org/company → any; narrow → session `createdById==caller` OR `calibrationMember`, else 403; missing → 404 |
| 8 | `myCalibrations` | self-service (createdBy OR member) | NOT org-wide, NOT scopeWhereFor (calibrationSession not a registered entity); bounded 100 |
| 9 | `getQuadrantPlan({quadrant})` | grant-only (PURE, no ctx) | `quadrantPlans` catalog lookup (fallback "Sin plan definido") |
| 10 | `getBenchStrength({period})` | `requireOrgScope` (F3) | quadrant distribution + highPotentialRatio (JS half-up), benchStrength (star+high_potential+enigma) |
| 11 | `getDashboardKpis({period})` | `requireOrgScope` (F3) | counts (evals / sessions / active-sessions) + quadrant distribution |

## Reuse (already in C#, do NOT re-port)
- `ScopeWhereFor(NineBoxEvaluation)` + `nine_box_evaluations` in `ScopeProbeRegistry.Tables` (both from Slice-8) — reads #1/#4.
- `SubjectInScope`/`SelfServiceGuard` (assertSubjectInScope) — reads #2/#3.
- `OrgGate.RequireOrgScopeSatisfied` (requireOrgScope, F3) — reads #6/#10/#11.
- `ReportingMath.JsRound` (JS half-up), `NodeIsoDateTimeOffsetConverter`, the staff-JWT gate pattern.

## New this slice
- **Calibration read entities + membership auth** (reads #6/#7/#8): read-only EF over `calibration_sessions`,
  `calibration_members`, `calibration_votes` (+ `users` for creator/member/voter/evaluatedUser names). Read #7's
  narrow-scope gate = a hand-rolled check (mirror TS ninebox.ts:309-329): if scope ∉ {organization, company},
  load the session (404 if none), allow if `createdById == callerId` else require a `calibration_members` row
  (403 otherwise). Read #8 = `createdById == caller OR EXISTS(calibration_members where userId=caller)`. This is
  NOT a registered ScopedEntity — do not route it through ScopeWhereFor (would throw). `efcoreReadOnly +=
  calibration_sessions, calibration_members, calibration_votes` (nine_box_evaluations already there from Slice-8).
- **⚠️ Native PG enums (eval360 #158 lesson):** `calibration_session.status` is FILTERED (`status != 'finalized'`
  in getDashboardKpis; `status='draft'` on the write) — check `ninebox.prisma`: if `status` is a native Postgres
  enum, use options-level `MapEnum` at EVERY DbContext registration (`UseNpgsql(ds, X.MapEnums)`); `HasPostgresEnum`
  alone does NOT type-map → int-materialization 500s the real-RLS integration catches. `quadrant` is plain `String`
  (confirmed in Slice-9) — no MapEnum. Verify each enum-ish column.

## Pure kernels — extract to `@tims/shared/ninebox.ts`, golden BOTH stacks (honest-fixture rule)
- **`gridPlacement(evaluations)`** (read #1): group by `quadrantToGrid[quadrant] ?? quadrant`; preserve `evaluatedAt desc` order within each key. The `quadrantToGrid` map is shared.
- **`computeMovements(evaluations)`** (read #4): group by user (input already ordered userId asc, evaluatedAt asc), emit a movement for each consecutive quadrant CHANGE (`prev.quadrant != curr.quadrant`) with from/to {period,quadrant}. Pin ordering + the "only-on-change" rule.
- **`simulateBands(pot, perf)`** (read #5): thresholds ≥67 high / ≥34 medium / else low → `simulateQuadrantMap[potBand][perfBand]`. Shared `simulateQuadrantMap`.
- **`quadrantPlans` catalog** (read #9): static map; fallback `{title:'Sin plan definido', actions:[]}`.
- **`benchStrength(evaluations)`** (read #10): distribution + `highPotentialCount = star+high_potential+enigma`, `highPotentialRatio = JsRound(highPotentialCount/total*100)` (0 when total 0). JS half-up.
- **`dashboardDistribution(evaluations)`** (read #11): quadrant→count map (counts come from EF).
Inject `nowMs` only if any kernel does date math (none here — dates come from EF rows). Match tRPC output field-for-field, raw model shape, no `schemaVersion`.

## Data plane (EF, read-only)
`Tims.Infrastructure/NineBox/` read-only (`AsNoTracking`) over `nine_box_evaluations` (+`users` for name/jobTitle/email
per read's exact select) and the 3 `calibration_*` tables, under `TenantScope`/RLS + explicit `organizationId` + the
scope predicate where applicable (reads #1/#4). `axisBreakdown`/`confidence` are jsonb/scalar passthroughs. Dates via NodeIso.

## Endpoints (dark behind `Platform:NineBoxReadEnabled`; build-only OpenAPI)
`NineBoxStaffGate` = `ninebox:read` grant (mirror ReportingStaffGate). Org-gate reads (#6/#10/#11) apply
`OrgGate`; scoped reads (#1/#4) thread `decision.Scope` into `scopeWhereFor`; subject reads (#2/#3) do
`assertSubjectInScope` (out-of-set → 403); read #7 does the hand-rolled membership gate (403/404); read #8 hand-rolls
the createdBy-OR-member filter; pure reads (#5/#9) validate input after auth. 11 GET endpoints; auth-before-parse.

## Regression corpus (Testcontainers, REAL RLS) — each bite-proven
- **scopeWhereFor row-drop** (reads #1/#4): out-of-scope nine_box_evaluations rows silently drop; input teamId/unitId only intersect (never widen).
- **assertSubjectInScope IDOR** (reads #2/#3): out-of-subject-set userId → 403.
- **F3 org-gate** (reads #6/#10/#11): narrow team/unit/own → 403, VALID staff slugs (#150 lesson).
- **calibration membership** (read #7): a committee member (narrow scope) can read a session they created OR are a member of, but NOT another's session (403); missing → 404; org/company scope reads any. (read #8): only the caller's own sessions surface.
- **Kernel parity**: grid placement / movement (only-on-change, ordering) / simulate bands / benchStrength ratio (half-up) — golden both stacks, bite on drift.
- Tenant isolation cross-org; dark-by-default all 11 routes → 404; auth matrix (grant→403/narrow→403/JWT→401/dark→404).

## Gate (agent-driven SDD)
3 adversarial reviews (security/auth + correctness/parity + Codex) all GO no Crit/High/Med → fix in-branch
bite-proven → PR → admin-merge past CI billing trap. Local gate from `services/Tims.Platform`: build 0-warn · format ·
unit + integration (Docker, REAL RLS — scope/subject/membership/enum bites live here) · `node scripts/table-ownership.mjs`;
TS touched (kernels) → api/web tsc + vitest.

## FE cutover (separate step after merge, dark)
`NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP` wrappers for the FE-consumed subset (verify call sites in the nine-box +
committee/calibration pages; note the succession nine-box page already consumes `listCriticalRoles` via the C# wrapper).
