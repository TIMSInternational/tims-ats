# Phase 5 Slice 9 — Compensation READ (FX-free subset) → C# (strangler #7, dark)

**Status:** design (build pending) · **Branch:** `feat/csharp-phase5-compensation-read`
**Flag:** `Platform:CompensationReadEnabled` (default `false`) · **Cutover:** deferred (Federico)
**Ledger:** `efcoreReadOnly` (reads over Prisma-owned tables; NO flip, NO new tables)

## Why this scope (FX-free subset first)
Compensation is the largest read surface yet (12 reads). Five of them (`getBandDistribution`,
`getPayEquity`, `simulateAdjustment`, `getTotalCompBreakdown`, `getDashboardKpis`) call
`convertMoney`/`sumMoney` → `getFxRate`, which fetches **live rates from an external API
(frankfurter.dev)** with a 6h cache + identity short-circuit (base==quote ⇒ rate 1). Porting a
LIVE FX API faithfully is a NEW external-integration decision (provider/caching/failure-mode, like
Quartz/Stripe.net) and breaks golden-parity (rates are non-deterministic). So this slice ports the
**7 FX-free reads**; the 5 FX-dependent reads = **Slice 9b** (deferred, needs an FX-gateway port +
Federico's external-integration greenlight). `roundMoney` is already ported (Phase-1 WP1.6).

## Source surface (spec = live TS `packages/api/src/routers/compensation.ts`)
Port these 7 READS; do NOT port the 2 writes (createAdjustment/approveAdjustment) or the 5 FX reads.

| # | Read | Auth / mechanic | FX? | Notes |
|---|------|-----------------|-----|-------|
| 1 | `getSalaryBands({companyId?})` | `compensation:read` (NO org-gate) | no | full salaryBand rows, `orderBy level asc` |
| 2 | `getMarketComparison({jobLevel?})` | `compensation:read` (NO org-gate, catalog) | no | bands → {level,title,internalMin/Mid/Max,currency} |
| 3 | `getBenefitsUtilization({companyId?})` | `compensation:read` + `requireOrgScope` (F3) | no | benefit plans + enrolled + utilization% (NO min-5, deliberate) |
| 4 | `getCompaRatioDistribution({companyId?,businessUnitId?})` | `compensation:read` + `requireOrgScope` (F3) | no | **min-5 suppression** — the meaty kernel |
| 5 | `listPendingAdjustments` | `compensation:read` + `scopeWhereFor('salaryAdjustment')` + `selectFor` + **fail-closed audit** | no | row-scoped + field-auth |
| 6 | `getEmployeeComp({userId})` | `compensation:read` + `assertSubjectInScope` + `selectFor('employeeCompensation')` + audit | no | via `getEmployeeCompForSubject` |
| 7 | `myCompensation` | `compensation:read` + own-pinned (subject=caller) + `selectFor` + audit | no | self-service; null-if-missing; NO org-gate |

## Reuse (already in C#, do NOT re-port)
- **`KAnonymity.SuppressBelowMin5(count)`** (`Tims.Domain/Access/KAnonymity.cs`) — byte-identical to TS
  `suppressBelowMin5`: 1..4 ⇒ `(Suppressed=true, Count=null)`; 0 or ≥5 ⇒ `(false, count)`. Used by read #4.
- **`ScopeWhereFor(SalaryAdjustment)`** → `SubjectAsync("userId")` (already handled) — read #5 row filter.
- **`SubjectInScope` / `SelfServiceGuard`** — `assertSubjectInScope` port for reads #6/#7 (subject ∈ caller's own/team/unit set; own ⇒ subject==caller trivially passes).
- **`FieldClassification` `employeeCompensation`** — ported in Slice-8 (reads #6/#7 selectFor).
- **`ReportingMath.JsRound`** (JS half-up), `NodeIsoDateTimeOffsetConverter`, restricted-audit `IDataAccessAuditor` (fail-closed), the staff-JWT gate pattern.

## New this slice (small)
- **`FieldClassification` `salaryAdjustment`** — port `classification.ts:69` + `select-for.ts:10`:
  previousSalary/newSalary/currency/reason → `[super, hr]`; type → `[super, hr, hrbp]` (confidential);
  status → `[super, hr, hrbp, leader, employee]` (internal). Anchors (always selected): id, organizationId, userId.
  Golden-fixture BOTH stacks (extend `contracts/access-fixtures/field-classification.json`, like Slice-8's employeeCompensation).
- **`ScopeProbeRegistry.Tables += salary_adjustments`** (`["userId"]="user_id"`, no Navs, no EntityRootTable — used only via `scopeWhereFor` row filter, never a by-id probe root). Mirror the succession `successors` entry. Bite via the translator.

## Pure kernels — extract to `@tims/shared/compensation.ts`, golden BOTH stacks (honest-fixture rule)
- **`buildCompaRatioDistribution(rows, nowMs?)`** — the read-#4 kernel (TS router returns it). Inputs = comp
  rows `{currentSalary, compaRatio}`. Produces `{distribution: {bucket: {suppressed, count}}, avgCompaRatio, totalEmployees, suppressed}`. Pin ALL its regression-corpus guards (each red-if-regressed):
  - 6 fixed buckets `<0.80 / 0.80-0.90 / 0.90-1.00 / 1.00-1.10 / 1.10-1.20 / >1.20`, bucket ONLY positive-salary rows (`currentSalary>0`) so Σ buckets = canonical positive population.
  - `avgCompaRatio` = mean of NON-null/NON-zero compaRatio values, **floored on the CONTRIBUTOR count** (`ratios.length`), NOT the row count (slice-6 round-7 finding-1) → null when 1..4 ratios contributed; JS half-up 2-dec.
  - **All-or-nothing empty-distribution** (slice-6 round-7 + round-13/14): if `suppressBelowMin5(positiveCount) || suppressBelowMin5(nonPositiveCount) || anyBucketSuppressed` ⇒ return `{distribution:{}, avgCompaRatio, totalEmployees:null, suppressed:true}` (NO bucket keys — present-key cardinality + `N−Σ` oracle). `totalEmployees` = positiveCount (NOT rows.length) so cross-endpoint subtraction collapses. 0 population ⇒ non-suppressed empty.
- **`buildBenefitsUtilization(plans, totalUsers)`** (read #3) — `utilization = JsRound((enrolled/totalUsers)*10000)/100` (0 when no users). Trivial but extract for honest parity.
- Reads #1/#2 are raw-model / trivial maps (no kernel); #5 is field-auth+audit (no pure kernel); #6/#7 share the `getEmployeeCompForSubject` selectFor DTO (mirror its field-set — currentSalary/currency/effectiveDate to super/hr/hrbp/leader/employee; compaRatio/variablePay/bandId to super/hr/hrbp; the exact §21 employeeCompensation matrix).

## Data plane (EF, read-only)
`Tims.Infrastructure/Compensation/` read-only (`AsNoTracking`) over `salary_bands`, `employee_compensations`,
`salary_adjustments` (+`benefit_plans`/`benefit_enrollments` for #3, +`users` for active headcount, +`companies`
for display currency where needed — but NO conversion in this slice) under `TenantScope`/RLS + explicit `organizationId`.
`efcoreReadOnly += salary_bands, salary_adjustments, benefit_plans` (+ enrollments/companies as needed;
employee_compensations already efcoreReadOnly from Slice-8). **⚠️ Native PG enums (eval360 #158 lesson):** check
`compensation.prisma` — `salaryAdjustment.status` is FILTERED (`status='pending'` in #5) and `.type` is selected; if
either is a native Postgres enum, use options-level `MapEnum` at EVERY DbContext registration (`UseNpgsql(ds, X.MapEnums)`)
— `HasPostgresEnum` alone does NOT type-map ⇒ int-materialization 500s that ONLY the real-RLS integration catches. Dates via NodeIso. Raw model shape, no `schemaVersion`.

## Endpoints (dark behind `Platform:CompensationReadEnabled`; build-only OpenAPI)
`CompensationStaffGate` = `compensation:read` grant (mirror ReportingStaffGate). Org-gate reads (#3,#4) apply
`OrgGate.RequireOrgScopeSatisfied` (narrow→403, F3). #5 threads `scopeWhereFor('salaryAdjustment')` + selectFor +
audit. #6 does `assertSubjectInScope(userId)` (subject ∉ caller set → 403) + selectFor + audit. #7 hard-pins subject=caller
(NO client id) — self-service, NO org-gate, null-if-missing. 7 GET endpoints; auth-before-parse.

## Regression corpus (each bite-proven)
- **min-5 (read #4):** compaRatio buckets suppress at 1..4; all-or-nothing empty-distribution on ANY sub-floor bucket
  OR sub-floor positive/nonPositive population; avgCompaRatio floored on CONTRIBUTOR count (10 rows / 1 ratio ⇒ null);
  0-population ⇒ non-suppressed empty; totalEmployees == positiveCount (no `N−Σ` oracle). Neutralize each guard → red.
- **field-auth (reads #5/#6/#7):** a `leader`/`employee`/`hrbp` caller NEVER receives restricted salaryAdjustment
  (previousSalary/newSalary/reason super/hr-only) or restricted employeeCompensation finance fields; never select-then-null.
- **subject-scope IDOR (read #6):** an out-of-subject-set userId → 403 (not the comp row); own scope subject==caller passes.
- **fail-closed audit (reads #5/#6/#7):** a failed `data_access_logs` write aborts BEFORE the response (restricted).
- **self-service (read #7):** subject hard-pinned to caller (client can't widen); missing row → null (not error).
- Tenant isolation cross-org; dark-by-default all 7 routes → 404; auth matrix (grant→403/narrow→403/JWT→401/dark→404).

## Gate (agent-driven SDD)
3 adversarial reviews (security/auth + correctness/parity + Codex) all GO no Crit/High/Med → fix in-branch
bite-proven → PR → admin-merge past CI billing trap. Local gate from `services/Tims.Platform`: build 0-warn · format ·
unit + integration (Docker, REAL RLS — the min-5 + enum + audit bites live here) · `node scripts/table-ownership.mjs`;
TS touched (kernels + field-class fixtures) → api/web tsc + vitest.

## FE cutover (separate step after merge, dark)
`NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP` wrappers for the FE-consumed subset among these 7 (verify actual
call sites in the compensation dashboard pages). Slice 9b (FX reads) + its FE wrappers follow once the FX gateway lands.
