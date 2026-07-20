# Phase 5 Slice 5 — Reporting / analytics READ → C# (design)

Date: 2026-07-18 · Domain #3 in the strangler order (`phase-5-strangler.md`: reporting/analytics = "mostly read
models/aggregation; pairs naturally with C#"). Follows the billing read recipe (Slices 3/3b). Dark-by-default,
cutover deferred, TS untouched except behavior-preserving pure-kernel extraction.

## Surface
`packages/api/src/routers/recruitment-analytics.ts` — 6 `permissionProcedure('vacancy','read')` reads, each
`requireOrgScope(ctx.access)` (ORG-scope only; narrow team/unit/own roles fail closed — Codex F3 invariant, MUST
port). Service `recruitment-analytics.service.ts` = pure aggregation over pipeline/offer data:
`getKpis`, `getFunnel`, `getSourceBreakdown`, `getTrend`, `getLostByDelay`, `getRecruiterSla`.

## Recipe (mirrors billing reads)
Per procedure: extract the PURE shaping into `@tims/shared` (honest-fixture rule — the golden reflects the REAL
export the router now returns, never a mirror) → C# `Tims.Domain/Reporting/*` pure kernel → golden fixture
`contracts/reporting-fixtures/*.json` asserted by BOTH stacks → read-only EF (AsNoTracking) under TenantScope/RLS
+ explicit org → staff-JWT + `vacancy:read` + **org-scope-required** gate → dark-by-default flag
`Platform:ReportingReadEnabled` → endpoints (OpenAPI at build, runtime dark). INTERNAL read = raw view shape,
NO schemaVersion (billing-reads lesson). Dates via `NodeIso…` converters where present.

## Increments
1. **Funnel kernel + honest golden (THIS increment).** Extract `buildFunnelView` (stage-merge-by-name, order
   sort, `pctOfMax`, `conversionPct`) into `@tims/shared`; TS `getFunnel` calls it (behavior-preserving). C#
   `Tims.Domain/Reporting/FunnelView.cs` + `FunnelViewBuilder`. Golden `contracts/reporting-fixtures/funnel-view.json`
   asserted by the REAL TS export + `Tims.UnitTests`. **Parity gotchas pinned:** merge-by-NAME (same-name stages
   summed, order = min); JS `Math.round` half-up (C# `Math.Floor(x+0.5)`, NOT banker's) for `pctOfMax`;
   `conversionPct` = `round(hired/apps*1000)/10` 1-decimal or null.
2. Trend kernel (`buildTrendView`) — 6-month UTC calendar buckets (oldest-first); pins the UTC-bucketing +
   month-arithmetic parity.
3. KPI kernel (`buildKpiView`) — avgDays (round), TTF/TTH from offers, offerAcceptRate, lostByDelay; the
   `hoursInStage`/`avgDays` helpers become shared pure fns.
4. sourceBreakdown + lostByDelay + recruiterSla kernels.
5. Read-only EF DbContext + entities (applications/offers/stages/vacancies aggregation) under TenantScope; the
   repository per-query ports; endpoints + dark flag + auth matrix (incl. narrow-scope → 403 org-gate).

## Ledger / RLS
All reads over Prisma-owned tables → `efcoreReadOnly` (no ownership flip). No new tables. Register each EF
`ToTable` in the ledger.

## Regression corpus
Port the pinned TS fixes on this surface (Codex F3 org-scope-gate; honest-empty-states — no fabricated
cost-per-hire/quality; conversion 1-decimal). Each a red-if-regressed golden/integration test.
