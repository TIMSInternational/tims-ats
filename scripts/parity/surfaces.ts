import type { NormalizeOpts } from './normalize';
import { ID_SENTINEL } from './ids';

export interface EndpointDef {
  name: string;
  csharpPath: string;
  tsProcedure: string;
  input: unknown;
  /** Set on a by-id (Tier-2) endpoint — its value is the SeedResources key (seed.ts)
   *  naming which resource id pair to thread: the org-A id is substituted into the
   *  `{id}` sentinel in `csharpPath` + `input` for parity/RBAC (see ids.ts
   *  `substituteEndpointId`), and the org-B id becomes the RLS Mode-A IDOR probe
   *  target (`rls.ts`). Absent ⇒ a static-path (Tier-1) endpoint. When set,
   *  `csharpPath` and any id-carrying `input` value MUST use the `{id}` sentinel. */
  idScopeKey?: string;
  /** Mode-A only. By default a by-id endpoint's CORRECT cross-tenant response is a
   *  denial STATUS (403/404) — so a 200 with an empty body is itself an anomaly (the
   *  route processed a cross-org id instead of 404ing = a possible missing-404 /
   *  existence-oracle), and the RLS check FAILS it. Set this `true` for the rare
   *  endpoint whose correct not-found/cross-tenant response is a 200 null-SHAPE rather
   *  than a 404 (e.g. ninebox `/employee/{id}` → `{evaluation:null, history:[]}`), so
   *  that shape reads as isolation-held. A genuine data leak (a populated body) still
   *  FAILS regardless. Probe each endpoint's real cross-org status before setting this. */
  crossTenantEmptyOk?: boolean;
  expectedByRole: Record<string, 200 | 403>;
  normalize?: NormalizeOpts;
  /** Set when this endpoint is NOT tenant-scoped — it returns the same
   *  global / per-deploy payload for every org (e.g. `/billing/config`, whose
   *  `{configured}` boolean is driven by Stripe env vars, not a per-org DB
   *  read). The RLS Mode B heuristic ("both orgs returned identical non-empty
   *  payloads ⇒ possible global leak") is INVERTED for such endpoints —
   *  identical payloads are the CORRECT, expected result — so the RLS check is
   *  reported as a documented N/A (`inconclusive`, rendered `[WEAK]`), never a
   *  spurious FAIL. Parity and RBAC still run unchanged: a global read must
   *  still match TS byte-for-byte and still enforce the same permission gate. */
  globalScope?: boolean;
}

export interface Surface {
  key: string;
  flag: string;
  roles: string[];
  /** The role whose token is used as the org-A/org-B parity+RLS probe identity
   *  — chosen explicitly here rather than implied by `roles[]` array position,
   *  so a future reorder of `roles` can't silently change which role probes
   *  cross-tenant isolation. RLS/parity probes should use an org-scoped role
   *  (one that returns 200 for a normal org-member request, not just a
   *  platform-owner bypass) so the probe actually exercises tenant scoping.
   *  Optional for now — `cli.ts`'s `resolveProbeRole` falls back to
   *  `roles[0]` (with a warning) when unset. */
  probeRole?: string;
  endpoints: EndpointDef[];
}

/**
 * Surface registry — one entry per cutover surface. Later check runners (Task 8 parity,
 * Task 9 RLS, Task 10 RBAC) iterate this map; they never hardcode a surface's routes/roles.
 */
export const SURFACES: Record<string, Surface> = {
  // ── compensation ────────────────────────────────────────────────────────────────────────────
  // UPDATE 2026-07-29: 5 of the original 7 registered compensation reads had their TS procedures
  // DELETED (NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP confirmed live in prod) — salary-bands,
  // benefits-utilization, compa-ratio-distribution, pending-adjustments and my-compensation are
  // REMOVED below (no TS side left to diff against for any of them). The 2 that survive
  // (market-comparison, employee) map to the router's zero-FE-consumer procedures, which stay live
  // — pre-existing dead code unrelated to this migration — so `verify compensation` still runs 2
  // REAL parity/RLS/RBAC checks, not a no-op. One flag Platform:CompensationReadEnabled still gates
  // the C# side for all 7 backend endpoints; only these 2 have a TS side left to compare against.
  //
  // FX EXCLUSION (unchanged): the 3 FE-consumed FX-dependent reads (getBandDistribution /
  // getTotalCompBreakdown / getDashboardKpis) were NEVER registered here — they are gated by the
  // separate Platform__FxReadsEnabled flag (the same FX-tied-endpoint exclusion applied to
  // `dei.getPayEquity` further down this registry), and their TS implementations are DELIBERATELY
  // RETAINED as the live production path for those 3 reads.
  //
  // RBAC (seed grants hr_admin compensation:read@org, hrbp @unit): market-comparison is a grant-only
  // org-catalog read → hrbp 200; employee is subject-scoped → hrbp 403 (target ∉ its subject set).
  compensation: {
    key: 'compensation',
    flag: 'Platform__CompensationReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'market-comparison',
        csharpPath: '/compensation/market-comparison',
        tsProcedure: 'compensation.getMarketComparison',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'level' },
      },
      // Tier-2 by-id: getEmployeeComp = permissionProcedure('compensation','read') + assertSubjectInScope.
      // Org-A target = a:hr_admin (has a comp row). super_admin bypass → 200; hr_admin reads its own id →
      // 200; hrbp @unit → the target ∉ its subject set → 403. Mode-A IDOR: org-A token → org-B b:hr_admin id.
      {
        name: 'employee',
        csharpPath: '/compensation/employee/{id}',
        tsProcedure: 'compensation.getEmployeeComp',
        input: { userId: ID_SENTINEL },
        idScopeKey: 'employee',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  // ── nine-box ────────────────────────────────────────────────────────────────────────────────
  // UPDATE 2026-07-29: 7 of the original 11 registered nine-box reads had their TS procedures
  // deleted (NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP confirmed live in prod) — grid, calibrations,
  // my-calibrations, bench-strength, dashboard-kpis, employee, calibration are REMOVED below (no
  // TS side left to diff against for any of them). The 4 that survive (movement-history, simulate,
  // quadrant-plan, axis-breakdown) map to the router's zero-FE-consumer procedures, which stay
  // live — pre-existing dead code unrelated to this migration — so `verify ninebox` still runs 4
  // REAL parity/RLS/RBAC checks, not a no-op. One flag Platform:NineBoxReadEnabled still gates the
  // C# side for all 11 backend endpoints; only these 4 have a TS side left to compare against.
  // RBAC (hr_admin ninebox:read@org, hrbp @unit): movement-history uses scopeWhereFor (hrbp →
  // 200-empty, fragile, OMITTED from expectedByRole); axis-breakdown is subject-scoped (hrbp @unit,
  // target ∉ subject set → 403); simulate/quadrant-plan are globalScope pure kernels (org-independent
  // by design → RLS N/A, parity + RBAC still run). super_admin bypasses.
  ninebox: {
    key: 'ninebox',
    flag: 'Platform__NineBoxReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'movement-history',
        csharpPath: '/ninebox/movement-history',
        tsProcedure: 'ninebox.getMovementHistory',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'simulate',
        csharpPath:
          '/ninebox/simulate?userId=e0000b0c-0000-4000-8000-000000000001&newPotentialScore=80&newPerformanceScore=40',
        tsProcedure: 'ninebox.simulate',
        input: { userId: 'e0000b0c-0000-4000-8000-000000000001', newPotentialScore: 80, newPerformanceScore: 40 },
        // pure kernel, userId is echoed (no DB lookup) → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      {
        name: 'quadrant-plan',
        csharpPath: '/ninebox/quadrant-plan?quadrant=star',
        tsProcedure: 'ninebox.getQuadrantPlan',
        input: { quadrant: 'star' },
        // pure catalog lookup → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: getAxisBreakdown = permissionProcedure('ninebox','read') + assertSubjectInScope;
      // takes ?period=2026-Q1. Org-A target = a:hr_admin (has a 2026-Q1 eval). super/hr_admin (own id)
      // → 200; hrbp @unit → target ∉ subject set → 403. Mode-A: → org-B b:hr_admin.
      {
        name: 'axis-breakdown',
        csharpPath: '/ninebox/employee/{id}/axis-breakdown?period=2026-Q1',
        tsProcedure: 'ninebox.getAxisBreakdown',
        input: { userId: ID_SENTINEL, period: '2026-Q1' },
        idScopeKey: 'employee',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  // ── succession ──────────────────────────────────────────────────────────────────────────────
  // UPDATE 2026-07-29: 8 of the original 9 registered succession reads had their TS procedures
  // deleted (NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP confirmed live in prod) — only `critical-role`
  // (getCriticalRole) survives below, since it's the one read with zero FE consumers, so its TS
  // side was never a cutover candidate and stays live. RBAC: hr_admin succession:read@org, hrbp
  // @unit — getCriticalRole uses assertScoped (an IDOR-safe by-id probe returning 404, not 403,
  // for out-of-scope).
  succession: {
    key: 'succession',
    flag: 'Platform__SuccessionReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      // UPDATE 2026-07-29: 8 of the original 9 endpoints here (critical-roles, flight-risk,
      // competency-coverage, roles-without-successor, comp-gap-alerts, dashboard-kpis,
      // suggested-successors, simulate-exit) were removed alongside the TS-deletion of their
      // procedures — packages/api/src/routers/succession.ts's listCriticalRoles/getFlightRisk/
      // getCompetencyCoverage/getRolesWithoutSuccessor/getCompGapAlerts/getDashboardKpis/
      // getSuggestedSuccessors/simulateExit and their FE tRPC fallback
      // (apps/web/lib/platform-api/succession.ts) have been deleted — there is no TS side left
      // to diff against for those 8. This surface stays registered (rather than removed
      // outright, unlike team-intel/billing-usage) because getCriticalRole below is NOT
      // deleted — it has zero FE consumers so was never wrapped, but its TS implementation is
      // still live, so `verify succession` still runs one REAL parity/RLS/RBAC check.
      // Tier-2 by-id: getCriticalRole = permissionProcedure('succession', 'read') +
      // assertScoped('criticalRole', id) — an IDOR-safe probe that returns 404 (NOT 403) for
      // out-of-scope, so hrbp is OMITTED from expectedByRole (404 isn't representable in a
      // 200|403 map and isn't an RBAC-permission signal). Org-A target = cr1 ('Parity Critical
      // Role A1', holder super_admin, seeded in seed.ts). Mode-A IDOR: org-A token → org-B
      // critical role → 404 (assertScoped's ScopedNotFound).
      {
        name: 'critical-role',
        csharpPath: '/succession/critical-roles/{id}',
        tsProcedure: 'succession.getCriticalRole',
        input: { id: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        // nested successors[] (≤1 seeded) → canonicalize any array by id before diffing.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
  // ── audit-log ────────────────────────────────────────────────────────────────────────────
  // Doesn't fit the other surfaces' org-scoped-RBAC shape: this surface's gate is PRINCIPAL
  // TYPE (platform owner vs everyone else — `users.is_platform_owner`, see PlatformOwnerGate.cs
  // + TS `platformProcedure`), independent of any org. Rather than add a new harness concept for
  // one surface, it reuses `roles`/`expectedByRole` with two sentinel role keys seed.ts already
  // has a home for: `platform_owner` (a real, org-less platform-owner identity — seeded once,
  // see the planSeed comment in seed.ts) and `org_admin` (an ordinary seeded role) as the denied
  // probe.
  'audit-log': {
    key: 'audit-log',
    flag: 'Platform__AuditLogReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    // MUST be the ALLOWED role (200), not the denied one: the parity check always calls
    // probeRole's token expecting success, and stripTrpcJson (scripts/parity/trpc.ts:11)
    // deliberately throws on any tRPC error response — a crash, not a soft [FAIL] — so
    // pointing probeRole at a denied role takes down the whole verify run. org_admin (403)
    // is still fully covered by the separate RBAC check via `tokensByRole`.
    probeRole: 'platform_owner',
    endpoints: [
      {
        name: 'logs',
        csharpPath: '/audit/logs',
        tsProcedure: 'platform.getCrossOrgAuditLogs',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        // This surface is intentionally cross-org (a platform owner sees every org's rows) — the
        // Mode-B "identical payload across orgs ⇒ leak" heuristic does not apply the way it does for
        // a genuinely global/config read (e.g. billing/config); it isn't tenant-scoped at all, so the
        // RLS check for this endpoint is a documented N/A, not a leak signal. Parity + RBAC (the
        // platform-owner-vs-denied gate) still run unchanged and are the meaningful checks here.
        globalScope: true,
      },
    ],
  },
  // 'access-review' read surface REMOVED (2026-07-31): all 3 registered TS procedures
  // (getAccessReview/exportAccessReviewCsv/listAccessReviewAttestations) were deleted —
  // NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP confirmed live in prod — so there is no TS side
  // left to diff against for any endpoint (unlike compensation/ninebox/succession above, no
  // zero-consumer procedure survives to keep a real check running). `verify access-review` is
  // now a no-op (see cutover.sh). The WRITE surface (attestAccessReview) is UNAFFECTED — it
  // still has a live TS procedure behind a separate flag and stays registered in
  // write-surfaces.ts's WRITE_SURFACES['access-review'].
  // ── engagement ──────────────────────────────────────────────────────────────────────────────
  // Coverage-audit addition (2026-07-27): the C# `EngagementReadEndpoints` (Phase-5 Slice 11, 14
  // read routes) has been mapped/dark since PR history predating this audit, and the `engagement`
  // write surface has existed in WRITE_SURFACES (write-surfaces.ts) the whole time — but this READ
  // surface was never registered, so `verify engagement` / `parity engagement` / `rls engagement`
  // errored "unknown surface". This entry closes that gap.
  //
  // 9 of the 14 reads (the Tier-1 static-path subset — confirmed against
  // EngagementReadEndpoints.cs's live route table). The remaining 5 (getSurveyResults,
  // getSurveyForResponse, getResultsByArea, getWordCloud, getSentiment) are by-id
  // (`/engagement/surveys/{surveyId}/...`) Tier-2 follow-ups needing a `survey` idScopeKey +
  // seeded survey rows in `SeedResources`/`seed.ts` — the same "needs the harness Mode-A id
  // extension" deferral already used above for compensation/evaluation360/ninebox/succession's
  // by-id reads, not a silent omission. One flag `Platform__EngagementReadEnabled`.
  //
  // Gating (per `EngagementReadEndpoints.cs`'s own docstring, grounded in
  // seed-access-matrix.ts:44-48,58-76,104,122): hr_admin holds `engagement` r/c/u/d@organization;
  // hrbp holds `engagement` read@unit (NOT org/company) — passes any GRANT-ONLY check but fails
  // `requireOrgScope`.
  //   - listSurveys / myPendingSurveys: grant-only / self-service (NO org-gate) → hrbp 200.
  //   - getEnps / getClimateHeatmap / getLowClimateAlerts / getDashboardKpis / getRotationRisk:
  //     staff gate THEN `requireOrgScope` (`AuthorizeOrgRollupAsync`) → hrbp 403 (unit ≠ org/company).
  //   - listActionPlans / listLeaderCommitments: `scopeWhereFor` row-filter (hrbp → 200-empty,
  //     fragile) → hrbp OMITTED from `expectedByRole`, same convention as nine-box's
  //     grid/movement-history above.
  // super_admin bypasses everywhere (code-guaranteed in both stacks, per the team-intel/succession
  // precedent above).
  engagement: {
    key: 'engagement',
    flag: 'Platform__EngagementReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'surveys',
        csharpPath: '/engagement/surveys',
        tsProcedure: 'engagement.listSurveys',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'my-pending-surveys',
        csharpPath: '/engagement/my/pending-surveys',
        tsProcedure: 'engagement.myPendingSurveys',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'enps',
        csharpPath: '/engagement/enps',
        tsProcedure: 'engagement.getEnps',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'climate-heatmap',
        csharpPath: '/engagement/climate-heatmap',
        tsProcedure: 'engagement.getClimateHeatmap',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'alerts',
        csharpPath: '/engagement/alerts',
        tsProcedure: 'engagement.getLowClimateAlerts',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'action-plans',
        csharpPath: '/engagement/action-plans',
        tsProcedure: 'engagement.listActionPlans',
        input: {},
        // scopeWhereFor row-filter — hrbp omitted (see the surface-level comment above).
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'leader-commitments',
        csharpPath: '/engagement/leader-commitments',
        tsProcedure: 'engagement.listLeaderCommitments',
        input: {},
        // scopeWhereFor row-filter — hrbp omitted (see the surface-level comment above).
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'dashboard-kpis',
        csharpPath: '/engagement/dashboard-kpis',
        tsProcedure: 'engagement.getDashboardKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'rotation-risk',
        csharpPath: '/engagement/rotation-risk',
        tsProcedure: 'engagement.getRotationRisk',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  // ── dei ─────────────────────────────────────────────────────────────────────────────────────
  // Coverage-audit addition (2026-07-27): `DeiReadEndpoints` (Phase-5 Slice 11b, 10 read routes +
  // Slice 11c's separately-flagged pay-equity) was mapped/dark with no verify surface at all —
  // this is the first registry entry for the `dei` domain.
  //
  // ALL 10 reads share the SAME grant-only `DeiStaffGate` (`permissionProcedure('dei','read')`,
  // NO org-gate — the reads are org-wide demographic rollups whose disclosure control is
  // k-anonymity in the pure kernel, not RBAC scope) — so every endpoint gets the identical
  // `expectedByRole`, grounded directly in seed-access-matrix.ts:
  //   - super_admin → 200: code-guaranteed bypass in both stacks (see the team-intel precedent
  //     above), also holds `dei` r/c/u/d@organization (seed-access-matrix.ts:34).
  //   - hr_admin → 200: `dei` read+export@organization (seed-access-matrix.ts:53) — a real grant.
  //   - hrbp → 403: `dei` is ABSENT from hrbp's module list entirely (seed-access-matrix.ts:58-76
  //     lists vacancy…compensation, never dei) — denied at the grant gate, not an org-scope 403.
  //
  // `getPayEquity` (`/dei/pay-equity`) is DELIBERATELY EXCLUDED: it is gated by the separate
  // `Platform__FxReadsEnabled` flag (not `Platform__DeiReadEnabled`), the same FX-tied-endpoint
  // exclusion already applied to compensation's live-FX reads elsewhere in this registry (see the
  // "FX-reads cutover" precedent) — a documented deferral, not an oversight. One flag
  // `Platform__DeiReadEnabled` covers the other 10.
  dei: {
    key: 'dei',
    flag: 'Platform__DeiReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'dashboard-kpis',
        csharpPath: '/dei/dashboard-kpis',
        tsProcedure: 'dei.getDashboardKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'gender-representation',
        csharpPath: '/dei/gender-representation',
        tsProcedure: 'dei.getGenderRepresentation',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'age-distribution',
        csharpPath: '/dei/age-distribution',
        tsProcedure: 'dei.getAgeDistribution',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'nationality-diversity',
        csharpPath: '/dei/nationality-diversity',
        tsProcedure: 'dei.getNationalityDiversity',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'ethnicity-distribution',
        csharpPath: '/dei/ethnicity-distribution',
        tsProcedure: 'dei.getEthnicityDistribution',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'disability-distribution',
        csharpPath: '/dei/disability-distribution',
        tsProcedure: 'dei.getDisabilityDistribution',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'leadership-diversity',
        csharpPath: '/dei/leadership-diversity',
        tsProcedure: 'dei.getLeadershipDiversity',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'hiring-funnel',
        csharpPath: '/dei/hiring-funnel',
        tsProcedure: 'dei.getHiringFunnel',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'promotion-equity',
        csharpPath: '/dei/promotion-equity',
        tsProcedure: 'dei.getPromotionEquity',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'inclusion-index',
        csharpPath: '/dei/inclusion-index',
        tsProcedure: 'dei.getInclusionIndex',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  // ── billing-invoices ────────────────────────────────────────────────────────────────────────
  // Coverage-audit addition (2026-07-27): `BillingReadEndpoints` (Phase-5 Slice 3) ships
  // `listInvoices`/`getInvoice` behind `Platform__BillingReadEnabled` — its own independent flag
  // (one flag per surface is this registry's convention), so it gets its OWN surface entry here.
  //
  // Only `listInvoices` (Tier-1, static path) is included here. `getInvoice` (by-id,
  // `/billing/invoices/{id}`) is a Tier-2 follow-up: it needs an `invoice` idScopeKey + a seeded
  // Invoice row pair in `SeedResources`/`seed.ts`, which does not exist yet — same documented
  // deferral pattern as the by-id endpoints noted elsewhere in this registry.
  //
  // Gating: `permissionProcedure('billing','read')` — the same `BillingStaffGate` used by the
  // rest of the billing router, and `billing` is SUPER-ADMIN-ONLY in seed-access-matrix.ts
  // (absent from both hr_admin's and hrbp's module lists) — hence the 1-allow/2-deny verdicts
  // below (super_admin: 200, hr_admin/hrbp: 403), no new grant needs seeding.
  'billing-invoices': {
    key: 'billing-invoices',
    flag: 'Platform__BillingReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'invoices',
        csharpPath: '/billing/invoices?take=20',
        tsProcedure: 'billing.listInvoices',
        input: { take: 20 },
        expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
};
