import type { NormalizeOpts } from './normalize';
import { ID_SENTINEL } from './ids';

export interface EndpointDef {
  name: string;
  csharpPath: string;
  /** The tRPC procedure to diff the C# response against.
   *
   *  OPTIONAL, because a surface outlives its TypeScript side. Once a domain's TS procedures are
   *  deleted (nine-box reads in #57), there is nothing left to diff — but the endpoint is still
   *  DEPLOYED, and its RLS Mode-A cross-tenant probe and RBAC deny assertions are still the only
   *  automated things standing between a regression in the live C# read path and a cross-org data
   *  leak. `checks/rls.ts` and `checks/rbac.ts` never read this field; only `checks/parity.ts` does.
   *
   *  So: omit it to keep an endpoint registered as C#-only. The parity check then reports `[WEAK]`
   *  with a reason rather than a silent pass — a did-not-run must never render as a tick. Deleting
   *  the endpoint (or the whole surface) instead is what removes the IDOR probe, which is a
   *  security-coverage regression, not a cleanup. */
  tsProcedure?: string;
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
  // FX EXCLUSION: the 3 FE-consumed FX-dependent reads (getBandDistribution / getTotalCompBreakdown
  // / getDashboardKpis) were NEVER registered here — they were gated by the separate
  // Platform__FxReadsEnabled flag (the same FX-tied-endpoint exclusion applied to
  // `dei.getPayEquity` further down this registry). UPDATE 2026-07-31: that flag is now confirmed
  // permanently live in prod, and these 3 procedures joined the other 5 already-removed
  // compensation reads — their TS implementations were deleted outright
  // (packages/api/src/routers/compensation.ts). They stay correctly UNREGISTERED here, same as
  // before, since there is no TS side left to diff against for any of them.
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
  // TS side DELETED 2026-08-05 (#57); surface RETAINED as C#-only. `packages/api/src/routers/ninebox.ts`
  // is gone outright — all 6 residual procedures, plus ninebox.schemas.ts / ninebox.helpers.ts and the
  // root.ts registration — so none of the four endpoints below has a `tsProcedure` any more. The
  // 2026-07-29 pass had already removed the other 7 registered reads (grid, calibrations,
  // my-calibrations, bench-strength, dashboard-kpis, employee, calibration).
  //
  // WHY THIS IS NOT DELETED, unlike succession/team-intel/billing-usage/reporting/evaluation360/audit-log.
  // Deleting the surface was the first instinct here and it was WRONG: only `checks/parity.ts` reads
  // `tsProcedure`. `checks/rls.ts` and `checks/rbac.ts` take `callCsharp` alone, so removing the surface
  // does not retire a stale TS comparison — it retires the RLS Mode-A cross-tenant IDOR probe and the
  // RBAC deny assertions.
  //
  // SCOPE, stated precisely, because an earlier draft of this comment overstated it: the surface
  // registers FOUR endpoints and `cli.ts` iterates `surface.endpoints` for rls and rbac, so these
  // probes cover 4 of the 11 C# read endpoints behind Platform__NineBoxReadEnabled. The other 7 left
  // this surface on 2026-07-29 and are probed by neither stack — that is a real, separate gap, not
  // something this entry closes.
  //
  // The one that matters is `axis-breakdown`: it fires org-A's token at org-B's employee id and fails
  // closed. Its C# coverage is NineBoxReadTests.cs:153-165 (present/absent period) and
  // NineBoxReadEndpointAuthTests.cs:161 (subject-scope 403 WITHIN one org) — neither is cross-org.
  // (Note the surface does have SOME C# cross-org coverage elsewhere:
  // NineBoxReadTests.cs:240 `GetGrid_crossOrg_isolatedUnderRls`. That is `getGrid`, not
  // `axis-breakdown`, and `getGrid` is not one of the 4 endpoints registered here.) So for
  // axis-breakdown specifically, deleting this surface would leave a regression that returns org-B's
  // nine-box evaluation PII to an org-A caller caught by nothing.
  //
  // So `verify ninebox` still runs: parity reports [WEAK] per endpoint (documented "no TS side to
  // compare", never a bare tick — see EndpointDef.tsProcedure), while RLS and RBAC run UNCHANGED and
  // still fail the command on a real isolation or permission regression.
  //
  // RBAC (hr_admin ninebox:read@org, hrbp @unit): movement-history uses scopeWhereFor (hrbp →
  // 200-empty, fragile, OMITTED from expectedByRole); axis-breakdown is subject-scoped (hrbp @unit,
  // target ∉ subject set → 403); simulate/quadrant-plan are globalScope pure kernels (org-independent
  // by design → RLS N/A, RBAC still runs). super_admin bypasses.
  //
  // The WRITE surface is UNAFFECTED — write-surfaces.ts's nineboxSurface tests the C# endpoints
  // directly via raw SQL + HTTP and never had a tsProcedure field. `verify-write ninebox` still runs a
  // REAL check on all 5 writes, including the membership anchor (hr_admin with ninebox:update but no
  // membership → 403 'miembro del comite').
  ninebox: {
    key: 'ninebox',
    flag: 'Platform__NineBoxReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'movement-history',
        csharpPath: '/ninebox/movement-history',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200 },
        normalize: { dropNullish: true, sortArraysBy: 'userId' },
      },
      {
        name: 'simulate',
        csharpPath:
          '/ninebox/simulate?userId=e0000b0c-0000-4000-8000-000000000001&newPotentialScore=80&newPerformanceScore=40',
        input: { userId: 'e0000b0c-0000-4000-8000-000000000001', newPotentialScore: 80, newPerformanceScore: 40 },
        // pure kernel, userId is echoed (no DB lookup) → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      {
        name: 'quadrant-plan',
        csharpPath: '/ninebox/quadrant-plan?quadrant=star',
        input: { quadrant: 'star' },
        // pure catalog lookup → org-independent → RLS N/A.
        globalScope: true,
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
        normalize: { dropNullish: true },
      },
      // Tier-2 by-id — THE reason this surface is retained. Mode-A fires org-A's Bearer token at
      // org-B's employee id against the live deployment, with a fail-closed positive control.
      // hrbp @unit → target ∉ subject set → 403.
      {
        name: 'axis-breakdown',
        csharpPath: '/ninebox/employee/{id}/axis-breakdown?period=2026-Q1',
        input: { userId: ID_SENTINEL, period: '2026-Q1' },
        idScopeKey: 'employee',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  //
  // ── succession ──────────────────────────────────────────────────────────────────────────────
  // READ surface REMOVED (TS-deletion, 2026-08-03, #58): this surface's last remaining endpoint
  // (`critical-role`, tsProcedure `succession.getCriticalRole`) was deleted from
  // packages/api/src/routers/succession.ts — which is now deleted OUTRIGHT, all 4 residual
  // procedures with it. The 2026-07-29 pass had already removed the other 8 registered reads
  // (critical-roles, flight-risk, competency-coverage, roles-without-successor, comp-gap-alerts,
  // dashboard-kpis, suggested-successors, simulate-exit); `getCriticalRole` was kept then ONLY
  // because its TS implementation was still live, which is what made `verify succession` a real
  // check. It no longer is, so this surface follows team-intel/billing-usage/reporting/
  // evaluation360/audit-log and is removed rather than left registered-but-no-op.
  //
  // `verify succession` is therefore now a NO-OP. That is a genuine reduction in this harness's
  // coverage and is recorded as such in scripts/deploy/cutover.sh's `succession` row — do NOT
  // read a green `verify succession` as evidence about the C# read surface. What still covers it:
  // the C# integration tests (SuccessionReadTests.cs / SuccessionReadEndpointAuthTests.cs,
  // including TeamScope_OutOfScopeRole_Is404_IdorProbe and
  // TeamScope_ListCriticalRoles_DropsOutOfScopeRole).
  //
  // The WRITE surface is UNAFFECTED and stays fully valid — write-surfaces.ts's successionSurface
  // tests the C# endpoints directly via raw SQL + HTTP with no tsProcedure field, so it never
  // depended on any TS procedure existing. `verify-write succession` still runs a REAL check on
  // all 5 writes.
  //
  // ── audit-log ────────────────────────────────────────────────────────────────────────────
  // REMOVED (TS-deletion, 2026-07-31): this surface's only endpoint (`logs`,
  // tsProcedure `platform.getCrossOrgAuditLogs`) was deleted from
  // packages/api/src/routers/platform/system.ts once NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP was
  // confirmed live in prod and the FE wrapper (apps/web/lib/platform-api/audit-log.ts) moved to
  // calling the C# service unconditionally — there is no TS side left to diff against. See
  // scripts/deploy/cutover.sh's `audit-log` row (status TS_DELETED) for the cutover-tooling
  // side of this change.
  //
  // ── access-review ────────────────────────────────────────────────────────────────────────
  // READ surface REMOVED (TS-deletion, 2026-07-31): report/export/attestations
  // (getAccessReview/exportAccessReviewCsv/listAccessReviewAttestations) were deleted from
  // packages/api/src/routers/platform/access-review.ts once NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP
  // was confirmed live — there is no TS side left to diff against, so `verify access-review` is
  // now a no-op (see cutover.sh's `access-review` row, status TS_DELETED). Its former
  // principal-type-gate pattern (platform owner vs everyone else — see `PlatformOwnerGate.cs` +
  // TS `platformProcedure`, independent of any org) is gone from this harness too.
  //
  // The WRITE surface (attestAccessReview) is UNAFFECTED here even though its own TS procedure
  // was ALSO deleted the same day (NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP confirmed live) —
  // write-surfaces.ts's WRITE_SURFACES['access-review'] tests the C# endpoint directly via raw
  // SQL + HTTP (no TS comparison, no tsProcedure field), so it has zero dependency on the TS
  // procedure's existence and stays fully valid/registered forever. `verify-write access-review`
  // still runs a real check (see cutover.sh's `access-review-write` row, status TS DELETED but
  // parity CLI invocation still `verify-write access-review`, not `NONE`).
  // ── engagement ──────────────────────────────────────────────────────────────────────────────
  // Coverage-audit addition (2026-07-27): the C# `EngagementReadEndpoints` (Phase-5 Slice 11, 14
  // read routes) has been mapped/dark since PR history predating this audit, and the `engagement`
  // write surface has existed in WRITE_SURFACES (write-surfaces.ts) the whole time — but this READ
  // surface was never registered, so `verify engagement` / `parity engagement` / `rls engagement`
  // errored "unknown surface". This entry closes that gap.
  //
  // UPDATE 2026-07-31: 7 of the original 9 registered engagement reads had their TS procedures
  // deleted (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod) — my-pending-surveys,
  // enps, climate-heatmap, alerts, action-plans, leader-commitments, dashboard-kpis are REMOVED
  // below (no TS side left to diff against for any of them). The 2 that survive (surveys,
  // rotation-risk) map to the router's zero-FE-wrapper procedures (listSurveys/getRotationRisk),
  // which stay live — pre-existing dead-or-live code unrelated to this migration — so
  // `verify engagement` still runs 2 REAL parity/RLS/RBAC checks, not a no-op. One flag
  // `Platform__EngagementReadEnabled` still gates the C# side for all 14 backend endpoints; only
  // these 2 have a TS side left to compare against. (getSurveyForResponse was never registered
  // here in the first place — it was always a Tier-2 by-id deferral, see the original comment
  // below — so its 2026-07-31 TS deletion needs no removal here.)
  //
  // Remaining 5 (getSurveyResults, getSurveyForResponse, getResultsByArea, getWordCloud,
  // getSentiment) are by-id (`/engagement/surveys/{surveyId}/...`) Tier-2 follow-ups needing a
  // `survey` idScopeKey + seeded survey rows in `SeedResources`/`seed.ts` — the same "needs the
  // harness Mode-A id extension" deferral already used above for
  // compensation/evaluation360/ninebox/succession's by-id reads, not a silent omission.
  //
  // Gating (per `EngagementReadEndpoints.cs`'s own docstring, grounded in
  // seed-access-matrix.ts:44-48,58-76,104,122): hr_admin holds `engagement` r/c/u/d@organization;
  // hrbp holds `engagement` read@unit (NOT org/company) — passes any GRANT-ONLY check but fails
  // `requireOrgScope`.
  //   - listSurveys: grant-only (NO org-gate) → hrbp 200.
  //   - getRotationRisk: staff gate THEN `requireOrgScope` (`AuthorizeOrgRollupAsync`) → hrbp 403
  //     (unit ≠ org/company).
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
  // ALL reads (registered here or not) share the SAME grant-only `DeiStaffGate`
  // (`permissionProcedure('dei','read')`, NO org-gate — the reads are org-wide demographic
  // rollups whose disclosure control is k-anonymity in the pure kernel, not RBAC scope) — so
  // every endpoint gets the identical `expectedByRole`, grounded directly in
  // seed-access-matrix.ts:
  //   - super_admin → 200: code-guaranteed bypass in both stacks (see the team-intel precedent
  //     above), also holds `dei` r/c/u/d@organization (seed-access-matrix.ts:34).
  //   - hr_admin → 200: `dei` read+export@organization (seed-access-matrix.ts:53) — a real grant.
  //   - hrbp → 403: `dei` is ABSENT from hrbp's module list entirely (seed-access-matrix.ts:58-76
  //     lists vacancy…compensation, never dei) — denied at the grant gate, not an org-scope 403.
  //
  // `getPayEquity` (`/dei/pay-equity`) is DELIBERATELY EXCLUDED: it is gated by the separate
  // `Platform__FxReadsEnabled` flag (not `Platform__DeiReadEnabled`), the same FX-tied-endpoint
  // exclusion already applied to compensation's live-FX reads elsewhere in this registry (see the
  // "FX-reads cutover" precedent) — a documented deferral, not an oversight.
  //
  // UPDATE 2026-07-31: `Platform__DeiReadEnabled` / NEXT_PUBLIC_DEI_READ_VIA_CSHARP were confirmed
  // live in prod, and 8 of the 10 registered TS procedures were DELETED, leaving this entry
  // registering only getEthnicityDistribution's and getDisabilityDistribution's endpoints.
  //
  // UPDATE 2026-08-06 (#60): those last two TS procedures are now deleted too
  // (packages/api/src/routers/dei.ts — see the TS-deletion note there), so BOTH endpoints drop
  // their `tsProcedure` and this surface has NO TS side left to diff against.
  // The SURFACE ITSELF IS DELIBERATELY KEPT REGISTERED, per `EndpointDef.tsProcedure`'s own
  // contract at the top of this file: omitting the field keeps the endpoint C#-only, so
  // `checks/parity.ts:24` reports an explicit `[WEAK]` did-not-run instead of a silent pass, while
  // `checks/rbac.ts` (hrbp 403 / hr_admin 200 against the LIVE C# route) and `checks/rls.ts`
  // (Mode B cross-org payload comparison) keep running. Deleting the whole surface — the treatment
  // the team-intel / reporting / billing-read / billing-usage / evaluation360 / audit-log /
  // access-review / succession entries got — would silently retire that RBAC + RLS coverage, which
  // for org-wide demographic rollups is a security-coverage regression, not a cleanup.
  // So: `verify dei` still runs REAL RBAC + RLS checks; only the parity diff is gone. Its parity
  // coverage now lives in services/Tims.Platform/tests/Tims.IntegrationTests/Dei/
  // DeiReadEndpointTests.cs (403 gate at :333-334, real bodies at :139-140) plus the golden kernel
  // fixtures (contracts/dei-fixtures/*.json).
  //
  // The dei router's ONLY surviving TS procedure — `generateReport` — is a MUTATION that was never
  // ported to C#, so it has no C# counterpart to diff against and belongs in neither this
  // read-parity registry nor write-surfaces.ts (which diffs PORTED writes).
  dei: {
    key: 'dei',
    flag: 'Platform__DeiReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'ethnicity-distribution',
        csharpPath: '/dei/ethnicity-distribution',
        // tsProcedure omitted 2026-08-06 (#60) — dei.getEthnicityDistribution is deleted.
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'disability-distribution',
        csharpPath: '/dei/disability-distribution',
        // tsProcedure omitted 2026-08-06 (#60) — dei.getDisabilityDistribution is deleted.
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  // billing-invoices REMOVED (2026-07-31): the TS listInvoices/getInvoice procedures
  // (packages/api/src/routers/billing.ts) have been deleted — NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP
  // / Platform__BillingReadEnabled is confirmed live in prod, so there is no TS side left to diff
  // against (same treatment as the team-intel/reporting/billing-usage/evaluation360 entries removed
  // before this one — see scripts/deploy/cutover.sh's billing-read row, now TS_DELETED).
};
