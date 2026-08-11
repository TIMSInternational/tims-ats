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
  // ── monitoring (READ) ───────────────────────────────────────────────────────────────────────
  // Registered 2026-08-10 (#195, AC 1). Six routes, matching the six TS reads 1:1 — counted from
  // MonitoringReadEndpoints.cs, not taken from the issue text.
  //
  // WHY THIS ONE MATTERS MOST OF THE ~11 UNREGISTERED SURFACES: MonitoringReadEndpoints is DEPLOYED
  // and its RLS/RBAC probes have never run, and `Platform__MonitoringReadEnabled` is the single env
  // var gating ownership flips #64 and #68 (measured absent from the live App Runner service on
  // 2026-08-10). Registering it first means the flip can be parity-verified BEFORE it is flipped,
  // instead of flipped blind — the ordering that caught the real engagement-read failure in #166.
  //
  // UNLIKE the `organization` surface below, RLS HERE IS REAL AND RUNS. These are org-scoped reads
  // (`permissionProcedure('monitoring','read')` / `MonitoringStaffGate`, org id from the caller's
  // context), so no endpoint is `globalScope` and none is by-id: every one gets a Mode-B check, which
  // is the meaningful shape for a tenant-scoped aggregate.
  //
  // RBAC — the grants are seeded by seed.ts's seedMonitoringGrants, copied from
  // seed-access-matrix.ts rather than invented: hr_admin read@organization (:54), hrbp read@unit
  // (:70). ALL THREE granted roles expect 200, including hrbp: MonitoringStaffGate deliberately does
  // NOT force the org gate (its docblock:17-22 — the TS reader applies no `requireOrgScope` to any of
  // the six, so forcing it would 403 a role that reads these dashboards today). The only scope
  // mechanic is a `scopeWhereFor('actionPlan')` ROW filter on action-plan-alerts, which changes the
  // rows, not the status.
  //
  // That leaves no denial among the usual three roles, which would make the RBAC check vacuous — so
  // `org_admin` is added as the DENY role. It is absent from MATRIX entirely, holds no grants, and is
  // therefore refused by PermissionService itself: a GRANT-level 403, which proves the permission
  // check ran, not merely that some gate rejected an unknown principal.
  //
  // KNOWN RISK, stated rather than discovered at run time: these payloads are time-dependent
  // (KPI windows, a 6/12/24-month trend window, alert timestamps). Both stacks compute their window
  // independently, so a run that straddles a month boundary can diff spuriously. If that shows up,
  // the fix is a normalize rule here — not a code change.
  monitoring: {
    key: 'monitoring',
    flag: 'Platform__MonitoringReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp', 'org_admin'],
    probeRole: 'hr_admin', // org-scoped, org-wide grant — a real 200, not a super_admin bypass.
    endpoints: [
      {
        name: 'executive-kpis',
        csharpPath: '/monitoring/executive-kpis',
        tsProcedure: 'monitoring.getExecutiveKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200, org_admin: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'module-health',
        csharpPath: '/monitoring/module-health',
        tsProcedure: 'monitoring.getModuleHealth',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200, org_admin: 403 },
        normalize: { dropNullish: true },
      },
      // The Zod input is `.optional()` as a whole, with page/limit defaulting to 1/20 — send them
      // explicitly so the C# query string and the tRPC input describe the same page.
      {
        name: 'alerts',
        csharpPath: '/monitoring/alerts?page=1&limit=20',
        tsProcedure: 'monitoring.getActiveAlerts',
        input: { page: 1, limit: 20 },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200, org_admin: 403 },
        normalize: { dropNullish: true },
      },
      // hrbp reaches this one but sees scopeWhereFor('actionPlan')-filtered ROWS. Status is still
      // 200, which is all the RBAC check asserts; the row filter is a parity concern, not an RBAC one.
      {
        name: 'action-plan-alerts',
        csharpPath: '/monitoring/action-plan-alerts',
        tsProcedure: 'monitoring.getActionPlanAlerts',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200, org_admin: 403 },
        normalize: { dropNullish: true },
      },
      // `metric` has NO default on the TS side (period defaults to 12m) — it must be supplied or Zod
      // rejects the call before any of this is exercised.
      {
        name: 'cross-module-trend',
        csharpPath: '/monitoring/cross-module-trend?metric=headcount&period=12m',
        tsProcedure: 'monitoring.getCrossModuleTrend',
        input: { metric: 'headcount', period: '12m' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200, org_admin: 403 },
        normalize: { dropNullish: true },
      },
      {
        name: 'alert-rules',
        csharpPath: '/monitoring/alert-rules',
        tsProcedure: 'monitoring.getAlertRules',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200, org_admin: 403 },
        normalize: { dropNullish: true },
      },
    ],
  },
  // ── platform organizations (READ) ───────────────────────────────────────────────────────────
  // Registered 2026-08-10 (#195), immediately after Phase-5 slices 19 (PR #198) and 20 (PR #202)
  // shipped the C# port. #195's own body says `organization` is NOT a gap "because they have no C#
  // endpoints at all" — that was TRUE when it was written and is now stale: PlatformOrganizationsRead
  // Endpoints ships 3 routes and PlatformOrganizationsWriteEndpoints 2.
  //
  // WHY THIS MATTERS MORE THAN A TYPICAL REGISTRATION: without it, step 5 (verify in prod) for the
  // whole organizations domain was not "Federico-gated" but UNRUNNABLE BY ANYONE, and #76's decision
  // comment requires the fail-closed audit divergence to be "pinned by a parity fixture" — an
  // obligation that could not be discharged while the surface was unregistered.
  //
  // BOTH FLAGS ARE STILL DARK, so `verify organization` is a PRE-flip readiness check: it proves the
  // C# responses match TS before Federico flips anything, which is exactly the order the strangler
  // recipe wants. Every endpoint keeps its `tsProcedure` — the TS side is still the live production
  // path — so these are REAL byte diffs, not `[WEAK]`.
  //
  // RLS IS N/A ON EVERY ENDPOINT, AND THAT IS THE CORRECT ANSWER, NOT A GAP. This surface is
  // `platformProcedure` on the TS side and `PlatformOwnerGate` on the C# side, over the UNSCOPED `db`
  // — it is cross-org BY DESIGN. A platform owner reading org B is the feature, so a Mode-A IDOR
  // probe would assert the opposite of the requirement. `globalScope: true` makes `checks/rls.ts`
  // report a documented N/A (it short-circuits at rls.ts:189, BEFORE the `idScopeKey` branch at :199)
  // rather than a spurious FAIL. The authorization boundary here is the GATE, and it is RBAC — not
  // RLS — that proves it, via the org_admin 403 on every endpoint. Same disposition and same reason
  // as the access-review / audit-log read surfaces below.
  //
  // probeRole is `platform_owner`. It was `org_admin` from #203 (2026-08-10) until 2026-08-11, and
  // THAT WAS A BUG THAT MADE `verify organization` UNRUNNABLE — caught by the review panel on this
  // change, which found the comment here justifying it as deliberate.
  //
  // Why it could not work: the probe identity's token is what the parity leg calls BOTH stacks with
  // (cli.ts:161-163), and `org_admin` expects 403 on every endpoint of this surface. On the C# side
  // `checks/parity.ts:47-55` fails closed on any non-200, so both endpoints report
  // "C# returned HTTP 403 (expected 200)". On the TS side it is worse than a FAIL: `stripTrpcJson`
  // (trpc.ts:11) THROWS on a tRPC error response, so the run crashes rather than reporting. That is
  // exactly the hazard the removed access-review entry documented in 2026-07-31 ("pointing probeRole
  // at a denied role takes down the whole verify run") — the note was deleted with the surface and
  // the lesson went with it, which is its own argument for keeping surfaces registered.
  //
  // The original rationale — "a platform owner is org-less and seeded only under org A (seed.ts:86),
  // so it has no org-B counterpart to probe with" — is a true fact that does not imply the
  // conclusion. `mintTokens` skips the org-B requirement for exactly this role (cli.ts:129), and
  // both endpoints here are `globalScope`, so no org-B token is ever needed. `probeRole` must simply
  // be a role the surface grants 200; that invariant is now asserted for EVERY surface in
  // surfaces.test.ts, so this class of defect cannot ship again unnoticed.
  //
  // `getOrganization` (the by-id detail read) is DELIBERATELY NOT REGISTERED HERE, and that is the
  // honest answer rather than a shortcut. It needs two things at once — a real org id bound into
  // `{id}`, and no Mode-A IDOR probe — and the only existing way to express the second is
  // `globalScope`, which surfaces.test.ts:46 explicitly forbids combining with `idScopeKey`
  // ("no by-id endpoint may claim org-independence"). That guard is CORRECT: `globalScope` means
  // "pure kernel, org-independent computation" (nine-box simulate/quadrant-plan), whereas this
  // endpoint reads org-specific rows and merely has no tenant boundary FOR THIS CALLER. Those are
  // different properties, and overloading one flag for both is precisely what would silently
  // disable a real IDOR probe on some future surface. The access-review entry below sidesteps it
  // with a fixed non-existent org id, which cannot work here — `getOrganization` 404s on an
  // unknown org (organizations.ts:100), so the platform_owner case would assert 404, not 200.
  // Registering it needs a distinct, explicit concept (a platform-owner "no IDOR by design" marker,
  // the read-side analogue of write-surfaces.ts's documented omission of `buildIdor` on
  // access-review `attest`). Filed rather than smuggled in under an existing flag.
  organization: {
    key: 'organization',
    flag: 'Platform__PlatformOrganizationsReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    probeRole: 'platform_owner', // the only role this surface answers 200 to — see the note above.
    endpoints: [
      {
        name: 'kpis',
        csharpPath: '/platform/organizations/kpis',
        tsProcedure: 'platform.getOrganizationKpis',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
      // The list is cross-org by definition (it enumerates EVERY tenant), so there is no per-org
      // payload to compare — the clearest case in the registry for globalScope.
      {
        name: 'list',
        csharpPath: '/platform/organizations',
        tsProcedure: 'platform.listOrganizations',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        normalize: { dropNullish: true },
        globalScope: true,
      },
    ],
  },
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
  // WHY THIS IS NOT DELETED, unlike succession/team-intel/billing-usage/reporting/evaluation360.
  // (audit-log and access-review used to be on that list; both were RE-REGISTERED C#-only on
  // 2026-08-11 on exactly the reasoning below — see their entries.)
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
  // evaluation360 and is removed rather than left registered-but-no-op.
  //
  // STANDING DEBT, 2026-08-11: that reasoning is the same one that removed audit-log and
  // access-review, and both were re-registered C#-only on 2026-08-11 because it does not survive
  // `tsProcedure` becoming optional (efb7553f). SIX surfaces are still deleted on it — succession,
  // team-intel, reporting, billing-read, billing-usage, evaluation360 (enumerated from
  // `cutover.sh --list`, which shows exactly those six with parity_command NONE; counted, because an
  // earlier draft of this comment wrote "5" and then listed six). They are deployed C# reads with no
  // RBAC assertion in this harness. They were NOT restored in the same change because, unlike the two
  // platform-owner surfaces, each is org-scoped RBAC and needs its own seeded grant fixture to prove
  // anything (the #166 false-FAIL failure mode). Tracked in #195, not fixed here.
  //
  // AND THAT IS THE SMALLER HALF OF THE GAP. Those six are merely the surfaces that were once
  // registered and then removed. Counting deployed ROUTES instead of surfaces, measured 2026-08-11:
  // `services/Tims.Platform/src/Tims.Api/**/*.cs` contains 132 `.MapGet/Post/Patch/Put/Delete(`
  // registrations and zero `MapGroup`, while SURFACES + WRITE_SURFACES hold 49 endpoints (23 + 26).
  // The difference is not exactly the uncovered count — nothing here proves a 1:1 route-to-endpoint
  // correspondence, and some Map calls are infra rather than domain routes — but the order of the gap
  // is unambiguous, and it includes whole domains that were NEVER registered (external-vendor,
  // billing self-serve/webhook writes, `/internal/alert-metrics`) plus most routes inside surfaces
  // that ARE registered (engagement registers 2 endpoints against 14 deployed reads; dei 2 of 11).
  // Do not read "the surface is registered" as "the domain is covered". #195 is the tracking issue.
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
  // RE-REGISTERED 2026-08-11, C#-only. Removed on 2026-07-31 (2950a06c) with the reason "no TS side
  // left to diff against"; the endpoints were never removed from the deployed service.
  //
  // WHY THE REMOVAL WAS WRONG UNDER TODAY'S RULES, stated precisely so this is not undone again:
  // `tsProcedure` became OPTIONAL on 2026-08-06 (efb7553f) — SIX DAYS AFTER this surface was
  // deleted (`git merge-base --is-ancestor 2950a06c efb7553f` confirms the order). At deletion time
  // the field was mandatory and a dangling procedure ref really would have crashed `verify` at
  // runtime, so removal was the only option available THEN. It is not the only option now: omitting
  // the field keeps the endpoint registered, parity reports `[WEAK]` with a reason, and — the part
  // that actually matters — the RBAC deny assertions keep running against the live C# path. That is
  // exactly the disposition nine-box got in #57 and dei got in #60.
  //
  // WHAT THIS RESTORES, AND WHAT IT DOES NOT. It restores the RBAC platform-owner-vs-org_admin
  // assertions and the C#-returns-200 liveness check. It does NOT restore an RLS Mode-A IDOR probe:
  // every endpoint here is `globalScope`, so `checks/rls.ts` reports a documented N/A — that was
  // true of the deleted entry too (it set `globalScope: true` on `logs`), so no cross-tenant probe
  // was lost in 2026-07-31 and none is regained here. On a surface whose gate is PRINCIPAL TYPE
  // rather than tenancy, RBAC is the entire boundary proof, which is what makes the deny assertion
  // the whole point rather than a nice-to-have.
  //
  // URGENCY: `Platform__AuditLogReadEnabled=true` is LIVE on the App Runner service (measured
  // 2026-08-10), so this is a surface serving production traffic that has had no automated
  // permission assertion since 2026-07-31.
  //
  // Gate shape: PRINCIPAL TYPE (platform owner vs everyone else — `users.is_platform_owner`, see
  // PlatformOwnerGate.cs + TS `platformProcedure`), independent of any org. Rather than add a new
  // harness concept it reuses `roles`/`expectedByRole` with two role keys seed.ts already seeds:
  // `platform_owner` (a real, org-less platform-owner identity — planSeed's comment) and `org_admin`
  // (an ordinary seeded role) as the denied probe. org_admin needs no grant fixture here: the gate
  // rejects it on the `is_platform_owner` bit BEFORE any permission lookup.
  'audit-log': {
    key: 'audit-log',
    flag: 'Platform__AuditLogReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    // MUST be the ALLOWED role (200), not the denied one: the parity check always calls probeRole's
    // token expecting success — including on the C#-only path, which fails the endpoint outright on
    // any non-200 (checks/parity.ts:26-33) — so pointing probeRole at a denied role would fail every
    // endpoint. org_admin (403) is still fully covered by the separate RBAC check via `tokensByRole`.
    // cli.ts's mintTokens deliberately skips the org-B token requirement for this role.
    probeRole: 'platform_owner',
    endpoints: [
      {
        name: 'logs',
        csharpPath: '/audit/logs',
        // tsProcedure omitted: `platform.getCrossOrgAuditLogs` was deleted 2026-07-31 (2950a06c).
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        // Intentionally cross-org (a platform owner sees every org's rows) — Mode B's "identical
        // payload across orgs ⇒ leak" heuristic asserts the opposite of the requirement here. The
        // RLS check is a documented N/A, not a leak signal.
        globalScope: true,
      },
      // NEW COVERAGE, not a restoration: `/audit/logs/export` (AuditReadEndpoints.cs:63) was NEVER
      // registered, in the original entry or since, so it has never had an RBAC deny assertion
      // despite being deployed behind the same live flag and the same gate. Counted from the
      // endpoints file (2 routes), not carried over from the deleted entry (1).
      {
        name: 'export',
        csharpPath: '/audit/logs/export',
        // tsProcedure omitted: `platform.exportAuditLogsCsv` was deleted in the same commit.
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
    ],
  },
  // OPERATIONAL WARNING for whoever runs `verify audit-log` — it EGRESSES CROSS-TENANT DATA to the
  // machine it runs on. `/audit/logs` returns the 20 most recent audit rows across EVERY org and
  // `/audit/logs/export` up to 1000 (AuditReadRepository's ExportCap), each carrying actor email, IP
  // address and metadata; both are fetched twice per run (parity probe + RBAC allow). Nothing is
  // PRINTED — report.ts renders only check/endpoint/role/detail and never a response body — but the
  // payload is still pulled over the wire. Run it somewhere you would be willing to hold production
  // audit data. This is a property of the endpoints, not of the registration, and it was equally true
  // before 2026-07-31; it is written down here because nobody had written it down.
  // ── access-review ────────────────────────────────────────────────────────────────────────
  // RE-REGISTERED 2026-08-11, C#-only. Removed on 2026-07-31 (18282f96) for the same reason, on the
  // same day, and reinstated on the same rationale as `audit-log` above — see that entry's
  // "WHY THE REMOVAL WAS WRONG" and "WHAT THIS RESTORES" notes rather than restating them.
  // `Platform__AccessReviewReadEnabled=true` is likewise LIVE on App Runner (measured 2026-08-10).
  //
  // THE FIXED ORG ID IS DELIBERATE AND IS NOT A BY-ID ENDPOINT. All three routes take a REQUIRED
  // `organizationId` query param, and the all-zeros UUID below is a non-existent org, carried over
  // verbatim from the deleted entry. Neither expectation depends on that org existing: the 403
  // (org_admin) is produced by PlatformOwnerGate before any org lookup, and the 200
  // (platform_owner) is an empty report — `AccessReviewService.BuildReportAsync` has no
  // org-exists precondition (only `AttestAsync` does, AccessReviewService.cs:35), so an unknown org
  // yields zero rows and a zero summary, not a 404. Verified against the source, not assumed: this
  // is exactly the property `getOrganization` lacks (it 404s on an unknown org), which is why THAT
  // read is still unregistered ~200 lines above.
  //
  // THE PINNED ID COLLIDES WITH A SENTINEL IN THIS DOMAIN'S OWN CODE, and that is worth knowing
  // rather than discovering. `AccessReviewService.cs:65` coalesces a NULL `users.organization_id` to
  // `Guid.Empty` — the SAME all-zeros value — and the rows with a NULL org are exactly the
  // platform-owner accounts. Today that is harmless: the repository filters with a plain
  // `u.OrganizationId == organizationId`, and in SQL `NULL = '000…'` is never true, so the report is
  // empty. But a future refactor to a coalescing or left-joined form would make this id select the
  // platform-owner roster, and every assertion in the registry would stay green. That outcome is
  // therefore PINNED, not assumed: AccessReviewEndpointAuthTests asserts zero rows and a zero
  // summary for this exact id.
  //
  // THE TWO REPORT ROUTES WRITE A SECURITY EVENT, so `verify access-review` is not literally
  // side-effect-free — it ATTEMPTS 4 INSERTs into `audit_logs` per run. None lands, and the reason is
  // measured rather than hoped: `audit_logs.organization_id` carries an enforced FK to
  // `organizations(id)` (`audit_logs_organization_id_fkey`, checked against the live database on
  // 2026-08-11, with no organizations row holding the all-zeros id), so every insert is rejected and
  // SecurityEventWriter.WriteAsync swallows it fail-soft (SecurityEventWriter.cs:36) rather than
  // 500ing the read. Two consequences, both now guarded: the integration test asserts ZERO
  // audit_logs rows for this org id, so dropping that FK fails CI instead of quietly making
  // `--verify-only` mutating; and cutover.sh's safety block documents the attempt, because a command
  // advertised as non-mutating must not have an undocumented write path.
  //
  // `globalScope` is correct here, but NOT for identical reasons to `audit-log`, and collapsing the
  // two would set the wrong precedent. `/audit/logs` takes no org parameter and is cross-org by
  // construction — the paradigm case. These three take a REQUIRED, CALLER-SUPPLIED `organizationId`
  // and read that org's rows, which is the "no tenant boundary for THIS CALLER" category the
  // `organization` entry above warns must never be confused with "pure kernel". They qualify only
  // because the pinned id resolves to no org at all, so there is no per-org payload to compare and
  // Mode B would be comparing two empty bodies. It does NOT collide with the `idScopeKey` guard —
  // the id is a fixed literal, never the `{id}` sentinel, so no Mode-A probe is being suppressed.
  // A version of this surface bound to a REAL org id would need the by-id platform-owner marker that
  // `getOrganization` is still waiting on; it must not simply inherit `globalScope` from here.
  //
  // The WRITE surface (attestAccessReview) was never affected by any of this — write-surfaces.ts's
  // WRITE_SURFACES['access-review'] hits the C# endpoint directly via raw SQL + HTTP and has no
  // `tsProcedure` concept at all, so `verify-write access-review` has run a real check throughout.
  'access-review': {
    key: 'access-review',
    flag: 'Platform__AccessReviewReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    probeRole: 'platform_owner', // see the audit-log entry's probeRole comment — same fix, same reason.
    endpoints: [
      {
        name: 'report',
        csharpPath: '/access-review?organizationId=00000000-0000-0000-0000-000000000000',
        // tsProcedure omitted: `platform.getAccessReview` was deleted 2026-07-31 (18282f96).
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
      {
        name: 'export',
        csharpPath: '/access-review/export?organizationId=00000000-0000-0000-0000-000000000000',
        // tsProcedure omitted: `platform.exportAccessReviewCsv` was deleted in the same commit.
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
      {
        name: 'attestations',
        csharpPath: '/access-review/attestations?organizationId=00000000-0000-0000-0000-000000000000',
        // tsProcedure omitted: `platform.listAccessReviewAttestations` was deleted in the same commit.
        input: { organizationId: '00000000-0000-0000-0000-000000000000' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
    ],
  },
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
  // the team-intel / reporting / billing-read / billing-usage / evaluation360 / succession entries
  // got, and that audit-log / access-review got before being re-registered C#-only on 2026-08-11 —
  // would silently retire that RBAC + RLS coverage, which
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
