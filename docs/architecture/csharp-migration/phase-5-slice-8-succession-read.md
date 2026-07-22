# Phase 5 Slice 8 — Succession READ surface → C# (strangler domain #6, dark)

**Status:** design (build pending) · **Branch:** `feat/csharp-phase5-succession-read`
**Flag:** `Platform:SuccessionReadEnabled` (default `false`) · **Cutover:** deferred (Federico)
**Ledger:** `efcoreReadOnly` (reads over Prisma-owned tables; NO flip, NO new tables)

## Why this slice
SIXTH strangler domain and the **richest scope surface yet** — its 9 reads exercise ALL THREE scope mechanics
in one domain: `requireOrgScope` (F3 org-gate), `assertScoped` (by-id IDOR probe), and `scopeWhereFor` (row-level
filter). Reuses the Phase-2 scope kernel wholesale: `criticalRole`/`successor` predicates ALREADY exist in
`Tims.Domain/Access/{ScopeWhereFor.cs,ScopedEntity.cs}` (ScopedEntity.CriticalRole/.Successor, CriticalRole ⇒
`SubjectAsync("currentHolderId")`, NOT_FOUND messages) — the ONE missing piece is the `criticalRole` **probe
table map** for `assertScoped` (register exactly like #151 added `offer`; `successor` is only used via
`scopeWhereFor`, so it needs no probe map).

## Source surface (spec = live TS `packages/api/src/routers/succession.ts`)
The service/repo logic is INLINE in the router (no separate service file) — read it directly. Tables:
`critical_roles`, `successors`. Port the 9 READS; do NOT port the 5 writes (addCriticalRole/addSuccessor/
removeSuccessor/updateSuccessorReadiness/updateCriticalRoleBand).

| # | Read | Scope mechanic | Body (verify against TS) |
|---|------|----------------|--------------------------|
| 1 | `listCriticalRoles({...})` | `scopeWhereFor('criticalRole')` + `scopeWhereFor('successor')` | roles + successors, row-scoped |
| 2 | `getCriticalRole({id})` | `assertScoped('criticalRole', id)` + `scopeWhereFor('successor')` | one role + its successors |
| 3 | `getFlightRisk({...})` | `requireOrgScope` (F3) | flight-risk scoring aggregate |
| 4 | `getCompetencyCoverage` | `requireOrgScope` | competency coverage aggregate |
| 5 | `getRolesWithoutSuccessor` | `requireOrgScope` | roles lacking a successor |
| 6 | `getCompGapAlerts` | `requireOrgScope` | comp-gap cross-link alerts |
| 7 | `getSuggestedSuccessors({...})` | `assertScoped('criticalRole')` + `scopeWhereFor(...)` | ranked successor suggestions |
| 8 | `simulateExit({...})` | `assertScoped('criticalRole')` + `scopeWhereFor('successor')` | exit-impact simulation |
| 9 | `getDashboardKpis` | `requireOrgScope` | succession KPI rollup |

## Scope wiring (mostly reuse; ONE registration)
- **Register `CriticalRole` in the probe table map** — `Tims.Domain/Access/ScopeProbeRegistry.EntityRootTable +=
  [ScopedEntity.CriticalRole] = "critical_roles"` (+ SoftDeletable set if critical_roles soft-deletes — check the
  Prisma model). Mirror #151's `offer` addition. Bite-prove: add criticalRole to `AnchorProbeFixture` (an in-scope
  id passes, an out-of-scope id → NOT_FOUND); repoint the "unregistered entity" probe test to a still-unregistered
  entity. Verify the `criticalRole` predicate (`SubjectAsync("currentHolderId")`) + its anchor loaders resolve for
  the reads' scope (currentHolderId → the role's current holder; scope narrows via the holder's team/unit).
- `assertScoped('criticalRole', id, decision.Scope, anchorLoaderFactory)` → 404-not-403 (reads 2, 7, 8) — the
  #151 live-AssertScoped pattern.
- `scopeWhereFor('criticalRole')` + `scopeWhereFor('successor')` → `ScopePredicateSqlTranslator` → parameterized
  WHERE (reads 1, 2, 7, 8) — the team-intel `compareTeams` pattern (out-of-scope rows drop).
- `requireOrgScope` (`OrgGate`) → 403 on narrow (reads 3, 4, 5, 6, 9) — the reporting/team-intel F3 pattern.

## Pure kernels — extract to `@tims/shared`, golden BOTH stacks (honest-fixture rule)
The reads carry non-trivial aggregation/scoring INLINE in the router. Extract each pure computation into
`@tims/shared/succession.ts`, make the TS router RETURN it (behavior-preserving), fixture against the REAL export
AND the C# port (`Tims.Domain/Succession/`): flight-risk scoring, competency-coverage %, suggested-successor
ranking/match score, simulate-exit impact, dashboard KPIs, comp-gap detection. Pin parity traps (JS half-up via
`ReportingMath.JsRound`; any ratio/percent rounding; sort stability/first-seen; null/empty→0/N-D; date/tenure
divisors if any). Inject `nowMs` where the TS uses `new Date()`.

## Data plane (EF, read-only)
`Tims.Infrastructure/Succession/` read-only (`AsNoTracking`) over `critical_roles`, `successors` (+ `users` for
holder/successor names, competency/comp tables for coverage + gap alerts — verify each read's joins) under
`TenantScope`/RLS + explicit `organizationId` + the scope predicate where applicable. Watch native PG enums
(readiness band / risk level etc. — **if any column is a native Postgres enum, use options-level `MapEnum` per the
eval360 #158 lesson: `HasPostgresEnum` alone does NOT type-map in EFCore.PG 10**; check `succession.prisma` for
enum columns). Dates via the NodeIso converter. `efcoreReadOnly += critical_roles, successors`. Raw model shape,
no `schemaVersion`. Match each tRPC output field-for-field.

## Endpoints (dark behind `Platform:SuccessionReadEnabled`; build-only OpenAPI)
`SuccessionStaffGate` = `succession:read` grant (mirror ReportingStaffGate); org-gate reads apply
`OrgGate.RequireOrgScopeSatisfied`; scoped reads thread `decision.Scope` into `assertScoped`/`scopeWhereFor`.
9 GET endpoints. Input validation after auth (note `{id:guid}` route constraint rejects malformed at routing).

## Regression corpus (Testcontainers, REAL RLS) — each bite-proven
- **F3 org-gate** (reads 3/4/5/6/9): narrow team/unit/own → 403, VALID staff slugs (#150 lesson).
- **assertScoped('criticalRole') IDOR** (reads 2/7/8): out-of-scope role → 404; neutralize probe → flips. The NEW
  probe-root registration bite (AnchorProbeFixture criticalRole in/out).
- **scopeWhereFor** (reads 1/2/7/8): out-of-scope criticalRole/successor rows silently drop.
- **Kernel math parity**: flight-risk/coverage/ranking/simulate/kpis/comp-gap — golden both stacks, bite on drift.
- Tenant isolation cross-org; dark-by-default all 9 routes → 404; auth matrix (grant→403/narrow→403/JWT→401/dark→404).

## Gate (agent-driven SDD)
3 adversarial reviews (security/auth + correctness/parity + Codex) all GO no Crit/High/Med → fix in-branch
bite-proven → Codex recheck PASS → PR → admin-merge past CI billing trap. Local gate from `services/Tims.Platform`:
build 0-warn · format · unit + integration (Docker up) · `node scripts/table-ownership.mjs`; TS touched (kernels)
→ api/web tsc + vitest.

## FE cutover (separate step after merge, dark)
Gate wrappers + one flag `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP`, swapping the call sites in
`talent/succession/page.tsx` (getDashboardKpis/listCriticalRoles/getCompetencyCoverage/getFlightRisk/
getRolesWithoutSuccessor/getCompGapAlerts), `talent/succession/suggested-successors.tsx` (getSuggestedSuccessors),
`talent/succession/exit-simulator.tsx` (simulateExit), `talent/nine-box/page.tsx` (listCriticalRoles). Per-read
shape/date/number parity; parallel platform-api invalidate at succession write mutations.
