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
 *
 * ── team-intel ───────────────────────────────────────────────────────────────────────────
 * tRPC procedure confirmed via `grep -rnE "getDashboardKpis|teamIntel" packages/api/src`:
 * router key `teamIntel` (packages/api/src/root.ts:74) + procedure `getDashboardKpis`
 * (packages/api/src/routers/teamIntel.ts:191), gated `permissionProcedure('team_intel', 'read')`
 * + `requireOrgScope(ctx.access)`. C# route `/team-intel/dashboard-kpis` + flag
 * `Platform__TeamIntelReadEnabled` were pre-confirmed (TeamIntelReadEndpoints.cs:251,
 * PlatformOptions.cs:145) — used verbatim.
 *
 * `roles`/`expectedByRole` — a representative 2-allow/1-deny subset (not the full 9-role
 * SYSTEM_ROLES set), each verdict grounded in code:
 *   - `super_admin` → 200, CODE-GUARANTEED in BOTH stacks independent of any seeded
 *     RolePermission/PermissionService row: TS `buildAccessForUser` short-circuits on
 *     `user.roles.includes('super_admin')` (packages/api/src/access/build.ts:21); C#
 *     `PermissionService` has the identical `SuperAdminRole = "super_admin"` bypass
 *     (services/Tims.Platform/src/Tims.Application/Identity/PermissionService.cs:18).
 *   - `hr_admin` → 200 per PRODUCT INTENT: seed-access-matrix.ts MATRIX grants hr_admin
 *     `team_intel` read/create/update/delete at `organization` scope
 *     (packages/db/prisma/seed-access-matrix.ts:44-49). NOT yet code-guaranteed for a
 *     freshly-seeded harness org — see RBAC-matrix flag in task-7-report.md.
 *   - `hrbp` → 403, CONFIRMED: MATRIX's hrbp entry omits `team_intel` from its module list
 *     (only learning/ninebox/succession/engagement/compensation get unit-scope read —
 *     seed-access-matrix.ts:58-76). No other role in the matrix grants team_intel either
 *     (leader is explicitly excluded per the comment at seed-access-matrix.ts:98-103;
 *     recruiter/committee/employee/external/candidate never list the module at all).
 *
 * ── billing-usage ─────────────────────────────────────────────────────────────────────────
 * The three billing READ procedures (`billing.getUsage` / `getCurrentPlan` / `getBillingConfig`,
 * packages/api/src/routers/billing.ts:25/16/11), all `permissionProcedure('billing','read')`.
 * On the C# side all three are mapped by `MapBillingUsageEndpoints` and gated by the single
 * `Platform:BillingUsageEnabled` flag (services/Tims.Platform/src/Tims.Api/Billing/
 * BillingUsageEndpoints.cs) — so ONE flag flip cuts the whole surface over, and the FE mirrors it
 * with one `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP` gate (apps/web/lib/platform-api/billing.ts).
 *
 * `roles`/`expectedByRole` — billing is SUPER-ADMIN-ONLY per the access matrix, so this is a
 * 1-allow/2-deny subset, each verdict grounded in code:
 *   - `super_admin` → 200, CODE-GUARANTEED in BOTH stacks independent of any seeded RolePermission:
 *     TS `buildAccessForUser` short-circuits on `super_admin` (packages/api/src/access/build.ts:21);
 *     C# `PermissionService` has the identical `super_admin` bypass. (RLS/TenantScope still applies —
 *     super_admin is org-scoped / own-org-only, NOT platform-reaching — so it is a valid tenant probe.)
 *   - `hr_admin` → 403: the MATRIX hr_admin module list OMITS `billing` entirely (it lists
 *     vacancy…evaluation360 + dei/monitoring/organization, never billing — seed-access-matrix.ts:44-56;
 *     the header note "hr_admin loses audit + feature_flags" reflects the same deliberate trimming).
 *     The parity seed grants hr_admin ONLY its team_intel:read row, so it definitively lacks billing:read.
 *   - `hrbp` → 403: hrbp's matrix entry (unit-scope) never lists billing either (seed-access-matrix.ts:58-76).
 * Because the only 200 role is the bypass role, NO role_permissions grant needs seeding for this surface
 * (contrast team-intel, which seeds hr_admin's grant to make it a real-grant 200).
 *
 * RLS: `/billing/usage` and `/billing/plan` are org-scoped (Mode B) — the seed inserts ONE
 * `subscriptions` row in org A only, so A vs B return different non-empty payloads. `/billing/plan`
 * is the AIRTIGHT leak detector: it returns the raw sub row for A vs top-level `null` for B, so ANY
 * subscription-table leak makes B echo A's row (identical non-empty ⇒ Mode B FAIL). `/billing/usage`
 * corroborates (A's paid-plan limits/period differ from B's trial-fallback), but its limits differ
 * unconditionally, so it can't by itself distinguish an asymmetric count leak — plan, reading the same
 * table under the same TenantScope/RLS, is what makes the surface RED on any real leak. (No by-id
 * endpoint exists for a strong Mode A probe — this is Mode B's documented limitation, not a gap here.)
 * `/billing/config` is `globalScope` — its `{configured}` boolean is env-driven and identical across
 * orgs by design, so RLS is N/A (parity + RBAC still run).
 */
export const SURFACES: Record<string, Surface> = {
  // ── compensation ────────────────────────────────────────────────────────────────────────────
  // 6 of the 7 compensation reads (the FX-FREE subset; the /employee/{userId} by-id read is a
  // Tier-2 follow-up needing the harness Mode-A id extension). `compensation.getSalaryBands/
  // getMarketComparison/getBenefitsUtilization/getCompaRatioDistribution/listPendingAdjustments/
  // myCompensation` → /compensation/{salary-bands,market-comparison,benefits-utilization,
  // compa-ratio-distribution,pending-adjustments,my-compensation}. All permissionProcedure(
  // 'compensation','read'). One flag Platform:CompensationReadEnabled + FE NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP.
  // RBAC (seed grants hr_admin compensation:read@org, hrbp @unit): grant-only reads (salary-bands/
  // market-comparison/pending-adjustments) → hrbp 200 (pending-adjustments returns scoped-empty rows,
  // not 403); requireOrgScope reads (benefits-utilization/compa-ratio-distribution) → hrbp 403;
  // my-compensation → hrbp 403 (SubjectInScope unit: caller's own id ∉ empty unit-member set).
  // compa-ratio-distribution needs ≥5 org-A comp rows in ONE compa bucket (min-5) or it self-
  // suppresses to an all-zero object identical to empty org B → false-fail; the seed provides 5.
  compensation: {
    key: 'compensation',
    flag: 'Platform__CompensationReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'salary-bands',
        csharpPath: '/compensation/salary-bands',
        tsProcedure: 'compensation.getSalaryBands',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'level' },
      },
      {
        name: 'market-comparison',
        csharpPath: '/compensation/market-comparison',
        tsProcedure: 'compensation.getMarketComparison',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'level' },
      },
      {
        name: 'benefits-utilization',
        csharpPath: '/compensation/benefits-utilization',
        tsProcedure: 'compensation.getBenefitsUtilization',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'name' },
      },
      {
        name: 'compa-ratio-distribution',
        csharpPath: '/compensation/compa-ratio-distribution',
        tsProcedure: 'compensation.getCompaRatioDistribution',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'pending-adjustments',
        csharpPath: '/compensation/pending-adjustments',
        tsProcedure: 'compensation.listPendingAdjustments',
        input: {},
        // grant-only gate; hrbp unit-scope → scoped-empty rows, HTTP 200 (NOT 403).
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'my-compensation',
        csharpPath: '/compensation/my-compensation',
        tsProcedure: 'compensation.myCompensation',
        input: {},
        // identity-anchored (own row); hrbp own id ∉ empty unit-member set → 403.
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
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
  // ── evaluation360 ───────────────────────────────────────────────────────────────────────────
  // 3 of the 5 eval360 reads (the 2 by-id cycle-progress/my-report are a Tier-2 follow-up needing
  // the harness Mode-A id extension). listCycles (STAFF org-gate, evaluation360:read) + myRaterTasks
  // + myReportCycles (SELF-SERVICE identity-anchored, no grant). One flag Platform:Evaluation360ReadEnabled.
  // RBAC: hr_admin seeded evaluation360:read@org (→ 200 on listCycles); hrbp NOT granted (matrix omits
  // eval360 — admin reads are org-only) → 403 on listCycles, but 200 on the self-service reads (they
  // apply no RBAC, return the caller's own data — empty for hrbp). super_admin bypasses.
  evaluation360: {
    key: 'evaluation360',
    flag: 'Platform__Evaluation360ReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'cycles',
        csharpPath: '/evaluation360/cycles',
        tsProcedure: 'evaluation360.listCycles',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // orders by created_at desc; the 2 seeded cycles share ~equal created_at → sort by id both sides.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'my-rater-tasks',
        csharpPath: '/evaluation360/my/rater-tasks',
        tsProcedure: 'evaluation360.myRaterTasks',
        input: {},
        // self-service: any resolved principal → 200 (its own tasks; empty for hr_admin/hrbp).
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'my-report-cycles',
        csharpPath: '/evaluation360/my/report-cycles',
        tsProcedure: 'evaluation360.myReportCycles',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      // Tier-2 by-id: getCycleProgress = STAFF (permissionProcedure('evaluation360','read') + requireOrgScope).
      // Org-A target = openA (super is a rater there → progress counts non-empty for super, who is excluded only
      // as a SUBJECT). super/hr_admin (org grant) → 200; hrbp ungranted for eval360 → 403. Mode-A: → org-B openB.
      {
        name: 'cycle-progress',
        csharpPath: '/evaluation360/cycles/{id}/progress',
        tsProcedure: 'evaluation360.getCycleProgress',
        input: { cycleId: ID_SENTINEL },
        idScopeKey: 'eval-cycle-staff',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: myReport = SELF-SERVICE (protectedProcedure, subject hard-pinned to ctx.user.id, no RBAC).
      // Org-A target = pubA (super is the published self-subject). super → 200; hr_admin/hrbp are NOT subjects of
      // pubA → 404 (indistinguishable from "not published"), which `200|403` can't express and isn't an RBAC
      // signal — so only super_admin is asserted. Mode-A: org-A super → org-B pubB → 404 (cross-org, not subject).
      {
        name: 'my-report',
        csharpPath: '/evaluation360/my/reports/{id}',
        tsProcedure: 'evaluation360.myReport',
        input: { cycleId: ID_SENTINEL },
        idScopeKey: 'eval-cycle-self',
        expectedByRole: { super_admin: 200 },
        normalize: { dropNullish: true },
      },
    ],
  },
  // ── nine-box ────────────────────────────────────────────────────────────────────────────────
  // 8 of the 11 nine-box reads (the 3 by-id employee/{userId}, axis-breakdown, calibrations/{id} are a
  // Tier-2 follow-up needing the harness Mode-A id extension). 6 org-scoped Mode-B (grid, movement-history,
  // calibrations, my-calibrations, bench-strength, dashboard-kpis) + 2 globalScope pure kernels (simulate,
  // quadrant-plan — org-independent by design → RLS N/A, parity + RBAC still run). One flag
  // Platform:NineBoxReadEnabled. RBAC (hr_admin ninebox:read@org, hrbp @unit): requireOrgScope reads
  // (calibrations, bench-strength, dashboard-kpis) → hrbp 403; grant-only reads (my-calibrations, simulate,
  // quadrant-plan) → hrbp 200; grid + movement-history use scopeWhereFor (hrbp → 200-empty, fragile) so
  // hrbp is OMITTED from their expectedByRole (the runner iterates only present keys). super_admin bypasses.
  ninebox: {
    key: 'ninebox',
    flag: 'Platform__NineBoxReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'grid',
        csharpPath: '/ninebox/grid?period=2026-Q1',
        tsProcedure: 'ninebox.getGrid',
        input: { period: '2026-Q1' },
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true },
      },
      {
        name: 'movement-history',
        csharpPath: '/ninebox/movement-history',
        tsProcedure: 'ninebox.getMovementHistory',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'calibrations',
        csharpPath: '/ninebox/calibrations',
        tsProcedure: 'ninebox.listCalibrations',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'my-calibrations',
        csharpPath: '/ninebox/my-calibrations',
        tsProcedure: 'ninebox.myCalibrations',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'bench-strength',
        csharpPath: '/ninebox/bench-strength?period=2026-Q1',
        tsProcedure: 'ninebox.getBenchStrength',
        input: { period: '2026-Q1' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'dashboard-kpis',
        csharpPath: '/ninebox/dashboard-kpis?period=2026-Q1',
        tsProcedure: 'ninebox.getDashboardKpis',
        input: { period: '2026-Q1' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
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
      // Tier-2 by-id: getEmployeeDetail/getAxisBreakdown = permissionProcedure('ninebox','read') +
      // assertSubjectInScope; both take ?period=2026-Q1. Org-A target = a:hr_admin (has a 2026-Q1 eval).
      // super/hr_admin (own id) → 200; hrbp @unit → target ∉ subject set → 403. Mode-A: → org-B b:hr_admin.
      {
        name: 'employee',
        csharpPath: '/ninebox/employee/{id}?period=2026-Q1',
        tsProcedure: 'ninebox.getEmployeeDetail',
        input: { userId: ID_SENTINEL, period: '2026-Q1' },
        idScopeKey: 'employee',
        // UNIQUE among the 9 by-id reads: getEmployeeDetail models a cross-tenant/absent id as a 200
        // null-SHAPE (`{evaluation:null, history:[]}`), not a 404 (verified live on both stacks) — so a
        // 200-empty here is isolation-held, not a missing-404 anomaly. All other by-id reads 404.
        crossTenantEmptyOk: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'period' },
      },
      {
        name: 'axis-breakdown',
        csharpPath: '/ninebox/employee/{id}/axis-breakdown?period=2026-Q1',
        tsProcedure: 'ninebox.getAxisBreakdown',
        input: { userId: ID_SENTINEL, period: '2026-Q1' },
        idScopeKey: 'employee',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: getCalibration = permissionProcedure('ninebox','read') + hand-rolled committee-membership
      // gate (org/company scope → any in-org session; narrow → creator-or-member else 403). Org-A target = the
      // org-A calibration session (created by super). super/hr_admin (org) → 200; hrbp not creator/member → 403.
      {
        name: 'calibration',
        csharpPath: '/ninebox/calibrations/{id}',
        tsProcedure: 'ninebox.getCalibration',
        input: { id: ID_SENTINEL },
        idScopeKey: 'calibration',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // nested members[]/votes[] arrays (≤1 each seeded); canonicalize any array by id before diffing.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
  // ── succession ──────────────────────────────────────────────────────────────────────────────
  // 6 of the 9 succession reads (the 3 by-id critical-roles/{id}, suggested-successors, simulate-exit
  // are a Tier-2 follow-up needing the harness Mode-A id extension). All org-scoped Mode B. One flag
  // Platform:SuccessionReadEnabled. RBAC (hr_admin succession:read@org [+ compensation:read@org from the
  // compensation seed, for the comp-gap secondary check], hrbp @unit): critical-roles uses scopeWhereFor
  // (hrbp → 200-empty, faithful — hrbp holds unit-scoped succession read); the org-rollup reads (flight-risk,
  // competency-coverage, roles-without-successor, comp-gap-alerts, dashboard-kpis) → requireOrgScope →
  // hrbp 403. super_admin bypasses.
  // (The critical_roles.target_band_level + nine_box_evaluations.updated_at columns that these reads / the
  // nine-box reads select were missing from prod and have been migrated in — the harness surfaced that drift.)
  succession: {
    key: 'succession',
    flag: 'Platform__SuccessionReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'critical-roles',
        csharpPath: '/succession/critical-roles',
        tsProcedure: 'succession.listCriticalRoles',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'flight-risk',
        csharpPath: '/succession/flight-risk',
        tsProcedure: 'succession.getFlightRisk',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'competency-coverage',
        csharpPath: '/succession/competency-coverage',
        tsProcedure: 'succession.getCompetencyCoverage',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // TS has no orderBy here; C# orders by roleId → canonicalize both by roleId before diffing.
        normalize: { dropNullish: true, sortArraysBy: 'roleId' },
      },
      {
        name: 'roles-without-successor',
        csharpPath: '/succession/roles-without-successor',
        tsProcedure: 'succession.getRolesWithoutSuccessor',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'comp-gap-alerts',
        csharpPath: '/succession/comp-gap-alerts',
        tsProcedure: 'succession.getCompGapAlerts',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'dashboard-kpis',
        csharpPath: '/succession/dashboard-kpis',
        tsProcedure: 'succession.getDashboardKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id: getCriticalRole/getSuggestedSuccessors/simulateExit = permissionProcedure('succession',
      // 'read') + assertScoped('criticalRole', id) — an IDOR-safe probe that returns 404 (NOT 403) for
      // out-of-scope. Org-A target = cr1 ('Parity Critical Role A1', holder super). super/hr_admin (org) → 200;
      // hrbp out-of-scope → 404 → OMITTED (404 isn't representable in 200|403 and isn't an RBAC-permission
      // signal). Mode-A IDOR: org-A token → org-B critical role → 404 (assertScoped ScopedNotFound). NOTE the
      // TS param name differs (`id` for getCriticalRole; `criticalRoleId` for the other two).
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
      {
        name: 'suggested-successors',
        csharpPath: '/succession/critical-roles/{id}/suggested-successors',
        tsProcedure: 'succession.getSuggestedSuccessors',
        input: { criticalRoleId: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        // ranked candidate list (from nine-box evals) — deterministic kernel; sort by userId to be safe.
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'simulate-exit',
        csharpPath: '/succession/critical-roles/{id}/simulate-exit',
        tsProcedure: 'succession.simulateExit',
        input: { criticalRoleId: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
  // ── reporting ───────────────────────────────────────────────────────────────────────────────
  // The six `recruitmentAnalytics.*` reads (packages/api/src/routers/recruitment-analytics.ts):
  // getKpis / getFunnel / getSourceBreakdown / getTrend / getLostByDelay / getRecruiterSla → C#
  // /reporting/{kpis,funnel,source-breakdown,trend,lost-by-delay,recruiter-sla} (ReportingReadEndpoints.cs),
  // all `permissionProcedure('vacancy','read')` + `requireOrgScope`, one flag `Platform:ReportingReadEnabled`,
  // one FE flag `NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP` (apps/web/lib/platform-api/reporting.ts, wired into
  // the /recruitment/analytics page components).
  //
  // expectedByRole — grounded in seed-access-matrix.ts + the requireOrgScope gate:
  //   - super_admin → 200: `vacancy` r/c/u/d @organization in the matrix (:35) AND the permission-bypass
  //     role in both stacks; org-scoped so it clears requireOrgScope. Parity/RLS probe identity.
  //   - hr_admin → 200: `vacancy` r/c/u/d @organization (seed-access-matrix.ts:44-46) — an org-scope grant
  //     that clears requireOrgScope. NOT code-guaranteed for a fresh harness org, so the seed grants
  //     hr_admin `vacancy:read`@organization (a real-grant 200, like team-intel — see seed.ts).
  //   - hrbp → 403: hrbp has `vacancy` r/c/u but only @UNIT scope (seed-access-matrix.ts:59). It PASSES the
  //     grant check but FAILS `requireOrgScope` (needs org/company scope) → 403. The seed grants hrbp
  //     `vacancy:read`@unit so its 403 exercises the real requireOrgScope path (not a bare no-grant deny).
  //
  // Period endpoints (kpis/source-breakdown/lost-by-delay) take `?period=` (z.enum, default 30D). The C#
  // caller (callers.ts callCsharp) uses `csharpPath` verbatim (no query-building), so the period is baked
  // into csharpPath AND passed as the tRPC `input` — both sides then explicitly use 30D (no default drift).
  //
  // RLS: all six are org-scoped Mode B (no by-id route → no Mode A). The seed populates org A ONLY with a
  // minimal recruitment dataset (vacancy+stages+candidate+applications incl. one overdue-rejected + optional
  // offer, all dated safely inside 30D / the current trend month); org B stays empty. So the fixed-shape
  // reads (kpis/funnel/trend/lost-by-delay) differ non-trivially (A non-zero vs B all-zero) and the array
  // reads (source-breakdown/recruiter-sla) are A-non-empty vs B-empty → strong Mode B passes, not `inconclusive`.
  reporting: {
    key: 'reporting',
    flag: 'Platform__ReportingReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'kpis',
        csharpPath: '/reporting/kpis?period=30D',
        tsProcedure: 'recruitmentAnalytics.getKpis',
        input: { period: '30D' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // nullable KPI fields (timeToFillDays/timeToHireDays/offerAcceptRatePct null when no data) —
        // superjson omits null, C# may emit it; drop nullish both sides.
        normalize: { dropNullish: true },
      },
      {
        // Second kpis probe at a NON-DEFAULT window. KpiView echoes `period`, so this catches a
        // C# port that ignored/misparsed the query param (would return period:'30D' data ≠ the TS
        // period:'90D') — coverage the 30D-only probes can't give. The seeded rows (≤20d old) fall
        // inside BOTH windows, so the values still match; only the window handling is under test.
        name: 'kpis-90d',
        csharpPath: '/reporting/kpis?period=90D',
        tsProcedure: 'recruitmentAnalytics.getKpis',
        input: { period: '90D' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'funnel',
        csharpPath: '/reporting/funnel',
        tsProcedure: 'recruitmentAnalytics.getFunnel',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'source-breakdown',
        csharpPath: '/reporting/source-breakdown?period=30D',
        tsProcedure: 'recruitmentAnalytics.getSourceBreakdown',
        input: { period: '30D' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'trend',
        csharpPath: '/reporting/trend',
        tsProcedure: 'recruitmentAnalytics.getTrend',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'lost-by-delay',
        csharpPath: '/reporting/lost-by-delay?period=30D',
        tsProcedure: 'recruitmentAnalytics.getLostByDelay',
        input: { period: '30D' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'recruiter-sla',
        csharpPath: '/reporting/recruiter-sla',
        tsProcedure: 'recruitmentAnalytics.getRecruiterSla',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  'billing-usage': {
    key: 'billing-usage',
    flag: 'Platform__BillingUsageEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    // org-scoped bypass role — 200 for a normal own-org request, so it exercises
    // tenant scoping as the parity/RLS probe identity (chosen explicitly, not by position).
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'usage',
        csharpPath: '/billing/usage',
        tsProcedure: 'billing.getUsage',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
        // buildUsageView emits honest `null` storage/apiCalls (+ null period for an org with no
        // sub); tRPC superjson omits null-valued keys where the C# JSON may emit them — drop
        // nullish on both sides so those don't register as false-positive parity diffs.
        normalize: { dropNullish: true },
      },
      {
        name: 'plan',
        csharpPath: '/billing/plan',
        tsProcedure: 'billing.getCurrentPlan',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
        // getCurrentPlan = the raw Subscription row (nullable stripe ids / trialEndsAt /
        // cancelledAt / lastStripeEventAt) OR top-level `null`. dropNullish reconciles the
        // superjson-omitted vs C#-emitted null columns on the seeded row.
        normalize: { dropNullish: true },
      },
      {
        name: 'config',
        csharpPath: '/billing/config',
        tsProcedure: 'billing.getBillingConfig',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
        // Env-driven `{configured}` — same for every org by design; RLS Mode B would false-flag
        // identical cross-org payloads as a "global leak", so mark it globalScope (RLS reported
        // N/A). Parity (the boolean must still match TS) + RBAC still run.
        globalScope: true,
        normalize: { dropNullish: true },
      },
    ],
  },
  'team-intel': {
    key: 'team-intel',
    flag: 'Platform__TeamIntelReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    // org-scoped (OrgGate) role that returns 200 for parity/RLS identity — chosen
    // explicitly, not by roles[] position; RLS/parity probes should use an
    // org-scoped role.
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'dashboard-kpis',
        csharpPath: '/team-intel/dashboard-kpis',
        tsProcedure: 'teamIntel.getDashboardKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // tRPC superjson omits null-valued keys; the C# JSON response may still emit them
        // explicitly (e.g. a nullable KPI field with no data yet) — drop nullish on both
        // sides before diffing so that difference doesn't register as a false-positive parity break.
        normalize: { dropNullish: true },
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
    probeRole: 'org_admin', // org-scoped role — RLS/cross-tenant probing is N/A here; see globalScope below.
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
  'access-review': {
    key: 'access-review',
    flag: 'Platform__AccessReviewReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    probeRole: 'org_admin', // org-scoped role — RLS/cross-tenant probing is N/A here; see globalScope below.
    endpoints: [
      {
        name: 'report',
        csharpPath: '/access-review?organizationId=00000000-0000-0000-0000-000000000000',
        tsProcedure: 'platform.getAccessReview',
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        // Platform-owner-gated (not org-RBAC), like audit-log — see that entry's own comment. The
        // fixed org id is arbitrary and need not exist: neither the 200 (platform_owner) nor the 403
        // (org_admin, blocked by PlatformOwnerGate before any org lookup) depends on org existence.
        globalScope: true,
      },
      {
        name: 'export',
        csharpPath: '/access-review/export?organizationId=00000000-0000-0000-0000-000000000000',
        tsProcedure: 'platform.exportAccessReviewCsv',
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
      {
        name: 'attestations',
        csharpPath: '/access-review/attestations?organizationId=00000000-0000-0000-0000-000000000000',
        tsProcedure: 'platform.listAccessReviewAttestations',
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
    ],
  },
};
