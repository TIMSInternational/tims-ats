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
  /** Mode-A suppression for a BY-ID endpoint whose gate is PRINCIPAL TYPE, not tenancy.
   *  Set ONLY together with `idScopeKey`, and only on an endpoint served by a
   *  platform-owner gate (TS `platformProcedure` / C# `PlatformOwnerGate`) over the
   *  UNSCOPED client: reaching another org's row IS the product requirement there, so a
   *  Mode-A IDOR probe would assert the exact opposite of it — org-A's (platform-owner)
   *  token SHOULD get a 200 carrying org-B's body, which `assertIsolated` correctly reads
   *  as a breach. It could not run anyway: `mintTokens` deliberately mints no org-B token
   *  for an org-less platform owner (cli.ts's `mintTokens`), so Mode A's positive control
   *  fails closed (checks/rls.ts). `checks/rls.ts` therefore short-circuits to a documented
   *  N/A (`inconclusive` → `[WEAK]`) at :224 with its OWN reason string, distinct from the
   *  globalScope one at :205, so a report reader can tell the two dispositions apart.
   *  Parity and RBAC still run UNCHANGED against the org-A id — and on a surface like this
   *  RBAC is the ENTIRE boundary proof (the denied ordinary role's 403), which is why
   *  surfaces.test.ts requires EVERY non-platform-owner role on an endpoint carrying this
   *  flag to be 403 — not merely that some 403 exists somewhere in the map. A role this
   *  endpoint answers 200 to would be a live tenant boundary that Mode A is being told to
   *  skip.
   *
   *  THIS IS NOT `globalScope`, and the two must never be merged. `globalScope` asserts
   *  the PAYLOAD is org-independent — a pure kernel or per-deploy config returning the
   *  same bytes for every org — which is why Mode B's "identical payloads ⇒ leak"
   *  heuristic is inverted for it and why surfaces.test.ts's "every globalScope endpoint
   *  is a pure kernel" test forbids it on a by-id endpoint. (Deliberately named rather
   *  than cited by line: this docblock's previous two line citations into that file were
   *  both stale on the day they were written, because the same commit inserted lines above
   *  the target.) This flag asserts nothing about the payload: the response IS org-specific
   *  and a different id returns different data. It says only that THIS CALLER has no
   *  tenant boundary to cross. Overloading `globalScope` to mean both is precisely what
   *  would silently retire a genuine IDOR probe on a future org-scoped by-id endpoint.
   *
   *  The read-side analogue of write-surfaces.ts's documented omission of `buildIdor` on
   *  access-review `attest`, reported the same way — except that the write side expresses
   *  it by OMITTING a builder, which the read side cannot: absence of `idScopeKey` already
   *  means "Tier-1 static path". Hence a POSITIVE marker. */
  noTenantBoundaryForCaller?: boolean;
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
  // probe would assert the opposite of the requirement. The authorization boundary here is the GATE,
  // and it is RBAC — not RLS — that proves it, via the org_admin 403 on every endpoint.
  //
  // N/A VIA TWO DIFFERENT FLAGS, AND THE DIFFERENCE IS THE WHOLE POINT (see `detail` below).
  //   kpis + list  → `globalScope: true`. checks/rls.ts short-circuits at :205 with the
  //                  "non-tenant endpoint" reason. Correct because the PAYLOAD really is
  //                  org-independent: `list` enumerates every tenant by construction.
  //   detail       → `noTenantBoundaryForCaller: true`. checks/rls.ts short-circuits at :224, BEFORE
  //                  the `idScopeKey` branch at :235, with a DISTINCT reason. Its payload is
  //                  emphatically org-SPECIFIC — a different `{id}` returns different data — so
  //                  claiming globalScope for it would be a false statement about the endpoint that
  //                  happens to produce the right verdict, which is how a flag gets overloaded until
  //                  it silently retires a real IDOR probe somewhere else.
  // The access-review / audit-log read surfaces below are the globalScope disposition, not this one.
  //
  // probeRole is `platform_owner`. It was `org_admin` from #203 (2026-08-10) until 2026-08-11, and
  // THAT WAS A BUG THAT MADE `verify organization` UNRUNNABLE — caught by the review panel on this
  // change, which found the comment here justifying it as deliberate.
  //
  // Why it could not work: the probe identity's token is what the parity leg calls BOTH stacks with
  // (`csharpCaller`/`tsCaller` in cli.ts's `runChecks`), and `org_admin` expects 403 on every
  // endpoint of this surface. On the C# side `checks/parity.ts:49-56` fails closed on any non-200,
  // so both endpoints report
  // "C# returned HTTP 403 (expected 200)". On the TS side it is worse than a FAIL: `stripTrpcJson`
  // (trpc.ts:11) THROWS on a tRPC error response, so the run crashes rather than reporting. That is
  // exactly the hazard the removed access-review entry documented in 2026-07-31 ("pointing probeRole
  // at a denied role takes down the whole verify run") — the note was deleted with the surface and
  // the lesson went with it, which is its own argument for keeping surfaces registered.
  //
  // The original rationale — "a platform owner is org-less and seeded only under org A (seed.ts:83-88),
  // so it has no org-B counterpart to probe with" — is a true fact that does not imply the
  // conclusion. `mintTokens` skips the org-B requirement for exactly this role (cli.ts), and no
  // endpoint here runs an RLS mode that needs an org-B token, so none is ever required. `probeRole`
  // must simply be a role the surface grants 200; that invariant is now asserted for EVERY surface in
  // surfaces.test.ts, so this class of defect cannot ship again unnoticed.
  //
  // `getOrganization` IS NOW REGISTERED (2026-08-11, #195) — see the `detail` endpoint below. It was
  // deliberately omitted until then, and the reason it was omitted is the reason the new flag exists
  // rather than a reuse of an old one. It needs two things at once: a real org id bound into `{id}`,
  // and no Mode-A IDOR probe. The only way to express the second used to be `globalScope`, which
  // surfaces.test.ts's "every globalScope endpoint is a pure kernel" test forbids combining with
  // `idScopeKey` — and that guard is
  // CORRECT, so it was NOT weakened: `globalScope` means "pure kernel, org-independent computation"
  // (nine-box simulate/quadrant-plan), whereas this endpoint reads org-specific rows and merely has
  // no tenant boundary FOR THIS CALLER. Those are different properties; overloading one flag for both
  // is what would silently disable a real IDOR probe on some future surface. The access-review entry
  // below sidesteps the problem with a fixed NON-EXISTENT org id, which cannot work here —
  // `getOrganization` 404s on an unknown org (organizations.ts:145 / the C# repository returns null at
  // PlatformOrganizationsReadRepository.cs:151-156, mapped to Results.NotFound() at
  // PlatformOrganizationsReadEndpoints.cs:133), so the platform_owner case would assert 404, not 200.
  // The answer was a distinct, explicitly-named marker — `noTenantBoundaryForCaller`, the read-side
  // analogue of write-surfaces.ts's documented omission of `buildIdor` on access-review `attest`
  // (write-surfaces.ts:1447-1448) — not a smuggled reuse of an existing one.
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
      // getOrganization — REGISTERED 2026-08-11 (#195) via `noTenantBoundaryForCaller`, the distinct
      // marker the old note above said this needed. NOT globalScope: this payload IS org-specific.
      //
      // The `{id}` sentinel is the harness's canonical placeholder, NOT the deployed route's spelling
      // — the deployed template is `/platform/organizations/{id:guid}`
      // (PlatformOrganizationsReadEndpoints.cs:114). That is not a mismatch: the harness never calls a
      // route by template, it substitutes a concrete id and builds a real URL (ids.ts:5-11).
      //
      // #211 RESOLVED 2026-08-11 — the four predicted divergences this comment used to describe
      // (`counts`/`_count` on BOTH endpoints, `lastLoginAt` vs `users[].lastLoginAt`,
      // `pendingInvoices` vs `invoices`) are fixed in the C# read models, TS-side unchanged: TS is the
      // live path, both C# flags are dark, so TS is the contract and C# moved.
      //
      // WHAT THE RUN ACTUALLY SHOWED: NOTHING YET. `verify organization` still has not been run
      // against production, because both `Platform__PlatformOrganizations{Read,Write}Enabled` are dark
      // and the harness is fail-closed against a dark backend by design. So these shapes remain
      // DERIVED FROM SOURCE and never observed at run time — exactly the epistemic status they had
      // before, and the reason the fix is pinned by serialization unit tests
      // (PlatformOrganizationsReadModelsSerializationTests.cs) rather than by a green parity report.
      // Do not restate this as "verified in prod".
      //
      // Fixing #211 also surfaced SIX divergences the issue never listed. Counted, then enumerated —
      // an earlier version of this sentence said "five" and then listed four:
      //   1. `settings` dropped from every organization object (TS uses `include`, not `select`, so
      //      every scalar is on the wire, and `settings` is NOT NULL — `dropNullish` cannot mask it).
      //   2. `deletedAt` dropped from the same objects.
      //   3. Every DateTime serialised without the trailing `Z` (Npgsql returns `timestamp without time
      //      zone` as DateTimeKind.Unspecified and STJ then omits the Z, while TS goes through
      //      `Date.prototype.toISOString()`).
      //   4. 27 guaranteed-non-null scalars (plus 11 nullable) dropped across the six nested records the
      //      TS pulls with bare `include`. COUNTED, not estimated: companies 8 + business units 6 +
      //      teams 6 + subscription 1 + feature flags 3 + billing profile 3. This read "29" until
      //      2026-08-11, inherited from prose whose own table summed to 27.
      //   5. The pending-invoice array was UNORDERED in both stacks, so any org with 2+ pending invoices
      //      could diff on row order alone (fixed on both sides: `orderBy: { id: 'asc' }` in TS, an
      //      ordinal-string OrderBy in C#).
      //   6. `sortBy: 'plan'` returned a COMPLETELY DIFFERENT ORDER. `organizations.plan` is the native
      //      `"OrgPlan"` enum, which Postgres sorts by DECLARATION order (trial, starter, professional,
      //      enterprise); C# mapped it to a string and sorted with `Comparer<string>.Default`, measured
      //      as enterprise, professional, starter, trial — the exact reverse. Fixed in
      //      PlatformOrganizationsReadRepository's `PlanRank`. NOTE THAT THIS SURFACE COULD NEVER HAVE
      //      CAUGHT IT: `list` is registered with `input: {}`, so `sortBy` is never sent. `sortBy:
      //      'name'` remains an OPEN residual — Postgres uses the DB collation, C# the process culture,
      //      and the repo does not record which collation prod uses. Filed as #214.
      // Any ONE of these was a guaranteed FAIL or a wrong page, so the four named in #211 were an
      // undercount, not the whole set.
      //
      // OPERATIONAL CONSEQUENCE 1 — THIS SURFACE IS NO LONGER DB-FREE, AND THE DEPENDENCY IS WIDER
      // THAN THIS ENDPOINT. `cli.ts`'s `needsResources` now fires for `organization`, which calls
      // `resolveResources` (seed.ts) — and that function resolves EVERY SeedResources key
      // unconditionally and throws on the first missing one. So `verify organization` now requires
      // DATABASE_URL plus the seeded employee users, the 2026-Q1 calibration sessions in BOTH orgs,
      // the "Parity Critical Role A1"/"B1" rows in both orgs and (since 2026-08-17, #195) the
      // "Parity Team A1"/"B1" teams in both orgs. An environment whose ninebox / succession /
      // team-intel fixtures were never seeded fails with e.g. `resolveResources: no seeded critical
      // role "Parity Critical Role A1" in org <uuid>` — a failure with no relationship to the surface
      // under test, and one that could not occur while this surface was Tier-1 only. Run
      // `cli.ts seed` first. (The org ids themselves cost zero extra queries: `orgA`/`orgB` are
      // already resolved for the calibration and critical-role lookups.)
      //
      // OPERATIONAL CONSEQUENCE 2 — a parity FAIL PRINTS DIFF VALUES (checks/parity.ts → normalize.ts
      // `DiffEntry {path, a, b}` → report.ts → console.log), and this is the first registered read
      // whose payload carries user records: `users[].email`, `firstName`, `lastName`, `jobTitle`,
      // `lastLoginAt` (organizations.ts:150-187). Against the seeded `__parity_a` org that data is
      // synthetic, so this is not a leak — but the harness now has a stdout/CI-log path for
      // user-shaped records that it did not have before. This argument USED TO REST on a
      // predicted-red block that guaranteed the diff branch would execute; that block was removed when
      // #211 was fixed, so the guarantee is gone and the hazard is not. It is now CONDITIONAL and still
      // real: these shapes have never been observed at run time (both flags are dark), so a FAIL on
      // first run is entirely possible, and a FAIL on this surface prints user-shaped records.
      // Do not point this endpoint at a real tenant's org id in a logged CI job.
      {
        name: 'detail',
        csharpPath: '/platform/organizations/{id}',
        tsProcedure: 'platform.getOrganization',
        input: { id: ID_SENTINEL },
        idScopeKey: 'organization',
        noTenantBoundaryForCaller: true,
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        // sortArraysBy is NOT cosmetic: both stacks order `users` by createdAt desc
        // (organizations.ts:119-131; PlatformOrganizationsReadRepository.cs) and seeded users can
        // share a created_at, making tie order nondeterministic across the two stacks.
        //
        // WHAT IT COSTS, stated because it is not free: `sortArraysBy` re-sorts EVERY array at EVERY
        // depth before the diff, so the users ordering this comment justifies is no longer COMPARED —
        // a C# side that dropped or reversed its OrderByDescending(u => u.CreatedAt) would still be
        // green here. Same for `companies[]`/`businessUnits[]`/`teams[]`, which neither stack orders.
        // The list endpoint's equivalent problem was solved the better way instead (a deterministic
        // `orderBy: { id: 'asc' }` in BOTH stacks, so no normalization is needed). Filed as #215; the
        // C#-side ordering is pinned meanwhile by PlatformOrganizationsReadRepositoryDetailTests, which
        // is a C#-only pin and not a cross-stack comparison.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
    ],
  },
  // ── invitation ──────────────────────────────────────────────────────────────────────────────
  // NEW 2026-08-12 (Phase-5 slice 22, issue #75). Registered in the SAME PR that deploys the routes, so
  // the #195 gap does not grow: the route-coverage guard would otherwise demand three new allowlist
  // entries, and an allowlist entry is a documented absence of a probe, not a probe.
  //
  // THIS ONE GETS A REAL PARITY DIFF, unlike audit-log/access-review. Those two are C#-only because their
  // TS procedures were deleted; these three are the LIVE production path (the flag is dark), so
  // `tsProcedure` is populated and `checks/parity.ts` compares actual payloads instead of reporting
  // [WEAK]. That makes this surface the strongest available check on the slice — and the only automated
  // one that can catch the two defect classes that cost #211/#216 nine divergences: a mis-serialised
  // DateTime and a dropped/renamed key.
  //
  // No grant fixture is needed, which is why this could be registered immediately while the six
  // org-scoped surfaces in the allowlist still cannot. PlatformOwnerGate decides on
  // `users.is_platform_owner` BEFORE any permission lookup, so `org_admin` is refused without holding any
  // `role_permissions` row — the same reasoning the audit-log entry sets out. No seed change accompanies
  // this registration.
  //
  // ⚠️ TWO OPERATIONAL CAVEATS FOR WHOEVER RUNS `verify invitation`. Both were found by an adversarial
  // review of this registration, and neither is visible from a PASS.
  //
  //   1. A PASS IS VACUOUS IF `platform_invitations` IS EMPTY. With no rows, `list` returns
  //      `{invitations: [], total: 0}` on BOTH stacks, diff() compares nothing, and every key name and
  //      date converter goes unexercised — i.e. the exact two defect classes this registration exists to
  //      catch (a mis-serialised DateTime, a dropped/renamed key) are the ones a vacuous PASS misses.
  //      Since no seed accompanies this entry, check the row count before believing a green result.
  //   2. THE EXPORT CAN FLAKE ON A created_at TIE. `list` carries `sortArraysBy: 'id'` precisely because
  //      ties are EXPECTED here, not unlucky — `bulkInviteUsers` inserts up to 200 rows in a loop at
  //      timestamp(3) precision and neither stack has a tiebreaker. The export's payload is a single CSV
  //      STRING, so no normalize rule can absorb the same tie: it will report a spurious FAIL in exactly
  //      the situation the list's mitigation exists for. The real fix is #215's both-stacks deterministic
  //      tiebreaker; until then, prefer a tie-free filter when running the export leg.
  invitation: {
    key: 'invitation',
    flag: 'Platform__PlatformInvitationsReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    // MUST be the role the surface answers 200 to. `org_admin` here would fail every endpoint outright —
    // checks/parity.ts calls probeRole's token expecting success and fails closed on any non-200, and the
    // TS leg THROWS in stripTrpcJson rather than reporting a FAIL. That is exactly how `organization`
    // shipped broken in #203 and was fixed in #205; the invariant is now asserted for EVERY surface by
    // surfaces.test.ts, so this cannot regress silently.
    probeRole: 'platform_owner',
    endpoints: [
      {
        name: 'kpis',
        csharpPath: '/platform/invitations/kpis',
        tsProcedure: 'platform.getInvitationKpis',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        // Four unfiltered cross-org COUNTs — no org-specific payload exists to compare, so Mode B's
        // "identical payload across orgs ⇒ leak" heuristic would assert the opposite of the requirement.
        globalScope: true,
      },
      {
        name: 'list',
        csharpPath: '/platform/invitations',
        tsProcedure: 'platform.listInvitations',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // WHY sortArraysBy IS NEEDED HERE, and WHAT IT COSTS — both stated, because it is not free.
        //
        // NEEDED: both stacks order by `created_at DESC` with NO tiebreaker, and ties are not theoretical
        // on this table — `bulkInviteUsers` inserts up to 200 rows in a tight loop, and `created_at` is
        // `timestamp(3)`, so collisions at millisecond precision are expected rather than unlucky. Tie
        // order is then unspecified in each stack independently and can differ between them, producing a
        // spurious FAIL.
        //
        // COSTS: it re-sorts EVERY array at EVERY depth before the diff, so the DESC ordering is no longer
        // compared at all — a C# side that reversed or dropped its OrderByDescending would stay green
        // here. That ordering is pinned instead by the C#-only integration test titled
        // `List_IsCrossOrg_ResolvesRelations_AndOmitsTheToken`, which asserts all five rows in order
        // against five distinct timestamps. A C#-only pin is weaker than a cross-stack comparison; it is
        // what is available without changing live TS behaviour.
        //
        // The better fix is the one #215 tracks and the organizations LIST already took: a deterministic
        // tiebreaker in BOTH stacks, after which no normalization is needed. That is deliberately NOT done
        // here — it would change the row order real users see today, and this slice ships dark with zero
        // live behaviour change. Doing both at once would make a parity FAIL uninterpretable.
        //
        // dropNullish is separate and also load-bearing: `organization` is null on any invitation whose
        // organization_id is null (a platform invitation can precede the org it creates), and
        // roleSlug/sentAt/acceptedAt are nullable too. Note it MASKS a nullable omission until the first
        // row that has a value, so those keys are asserted directly in the integration tests rather than
        // trusted to this diff.
        normalize: { dropNullish: true, sortArraysBy: 'id' },
      },
      {
        name: 'export',
        csharpPath: '/platform/invitations/export',
        tsProcedure: 'platform.exportInvitationsCsv',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // The payload is ONE string plus a count, so there is no array to sort and no null to drop —
        // and a byte-for-byte string comparison is the strictest diff in this registry. STRICTEST IS NOT
        // SAFEST: it is also the one endpoint here that cannot absorb a created_at tie, so see caveat (2)
        // in the surface header before treating a FAIL on this leg as a real divergence. It is also the
        // one place a CSV-shaping divergence shows up, which matters because this export deliberately
        // routes every cell through csvCell/CsvCell in BOTH stacks. This comment used to say the export
        // deliberately reproduced TS's unhardened hand-rolled CSV; that was true only between commits
        // 700807c9 and 7ad7b683, which fixed it on both sides at once (see the slice doc).
      },
    ],
  },
  // OPERATIONAL WARNING for whoever runs `verify invitation` — like `verify audit-log`, it EGRESSES
  // CROSS-TENANT PII to the machine it runs on. `/platform/invitations` returns up to 20 invitations
  // across EVERY org and `/platform/invitations/export` returns EVERY row with no cap at all (the TS
  // procedure passes no take/skip), each carrying an invitee EMAIL ADDRESS. Both are fetched twice per run
  // (parity probe + RBAC allow) and, with tsProcedure set, twice again on the TS leg. Nothing is printed —
  // report.ts renders only check/endpoint/role/detail, never a response body — but the payload crosses the
  // wire. Run it somewhere you would be willing to hold production invitee lists. This is a property of
  // the endpoints, not of the registration; it is written here because the unbounded export makes it
  // sharper than the audit-log case, which at least has an ExportCap.
  // ── dashboard ───────────────────────────────────────────────────────────────────────────────
  // NEW 2026-08-14 (Phase-5 slice 23, issue #81, PR 1 of 3). Registered in the SAME PR that deploys the
  // routes, so the #195 gap does not grow. Same platform-owner shape as `invitation`: TS procedures are
  // the LIVE path (flag dark), so all three keep a `tsProcedure` and yield a REAL payload diff; no grant
  // fixture is needed because PlatformOwnerGate decides on `users.is_platform_owner` before any
  // permission lookup, so org_admin is refused holding no grants at all.
  //
  // ⚠️ THREE OPERATIONAL CAVEATS FOR WHOEVER RUNS `verify dashboard`, none visible from a PASS:
  //
  //   1. `user-growth` IS DOUBLY TIME-DEPENDENT. Each stack computes its own six-month window from its
  //      own wall clock at request time, so a run straddling a MONTH boundary between the C# call and
  //      the TS call shifts every bucket by one and diffs spuriously. No normalize rule can absorb a
  //      whole-array shift; re-run away from the boundary. (Within a month the two clocks agree on
  //      every bucket, so this is a minutes-per-month exposure, same class as monitoring's trends.)
  //      ⚠️ THAT PARENTHETICAL DOES NOT HOLD FOR `mrr-forecast`, which shares this caveat as of PR 2.
  //      Alone among the nine, its TS side builds buckets and labels in the HOST's timezone rather than
  //      UTC: `dashboard-forecast.ts` uses `new Date()` + `setHours(0,0,0,0)` and a `toLocaleDateString`
  //      with NO `timeZone` — contrast `getMrrTrend`, which passes `timeZone: 'UTC'`, so the two TS
  //      procedures disagree with EACH OTHER off UTC. Off a UTC host the divergence is systematic, not
  //      minutes-per-month: every bucket bound moves by the host's offset, and near a month boundary all
  //      24 labels shift a month. Caveat 6 tells you to check LANG/LC_ALL; for this one check **TZ** on
  //      whatever runs the TS leg before reading an `mrr-forecast` diff as a port bug.
  //   2. `recent-activity` CAN FLAKE ON A created_at TIE — and worse than the invitations list: the
  //      per-source `take: 5` runs BEFORE the merge, so a tie AT THE FIFTH ROW can select DIFFERENT row
  //      SETS in the two stacks, which no sort-normalization can reconcile. Ties between an org and a
  //      user are handled (both stacks keep orgs first — pinned by C# unit + integration tie tests;
  //      the golden does NOT carry a tiebreak case, and the TS side's pin is the live implementation
  //      itself); ties WITHIN a source at the take boundary are not handleable. Deliberately NO
  //      `sortArraysBy` here: the merged DESC order (and its tiebreak) IS the kernel this surface
  //      exists to compare, and sorting it away would gut the diff.
  //   3. A PASS IS PARTLY VACUOUS ON EMPTY TABLES, but less than usual: with zero rows,
  //      `plan-distribution` still emits its four seeded buckets (order + keys + `|| 1` denominator all
  //      exercised) and `user-growth` still emits six labelled zero buckets (the Spanish month labels —
  //      THE known ICU divergence — are exercised on every run). Only `recent-activity` degenerates to
  //      `[]` and compares nothing; check `organizations`/`users` have rows before believing its green.
  //
  // FOUR MORE CAVEATS ARRIVED WITH PR 2 (2026-08-14), all on the six endpoints added below:
  //
  //   4. `attention-items` CAN FLAKE ON ROW SELECTION, not just ordering. Two of its five sources —
  //      past-due subscriptions and suspended organizations — have NO `orderBy` in the TS query at all,
  //      only `take: 20`. With more than 20 rows in either, WHICH twenty come back is unspecified in
  //      both stacks and they can legitimately differ. No normalize rule can reconcile different row
  //      SETS (the same limitation as caveat 2). Below 20 rows per source it cannot fire.
  //
  //   5. `customer-health` AND `upsell-opportunities` ORDER TIES BY DATABASE ROW ORDER. Both read
  //      `organizations` with no `orderBy`, then sort by a coarse key — health band, or mrrIncrease —
  //      with a STABLE sort in both stacks. So organizations sharing a band (or a plan) come back in
  //      whatever order Postgres returned them, which is unspecified. In practice a seq scan over a
  //      small table is stable across two calls seconds apart, which is why this is a caveat rather
  //      than a blocker; on a large, recently-updated `organizations` table it is a real risk.
  //      `sortArraysBy: 'orgId'` would fix the flake and DESTROY the check — the band ordering is the
  //      only thing these endpoints compute that a diff can see. Re-run rather than normalize.
  //
  //   6. `attention-items` EMBEDS A LOCALE-FORMATTED NUMBER IN A USER-FACING STRING, and the locale is
  //      the Node process's DEFAULT. `dashboard.helpers.ts` builds an overdue-invoice description with
  //      `inv.amount.toLocaleString()` — no locale argument — so an invoice of 1234.5 renders
  //      "$1,234.5 USD …" under ICU's en-US default and "$1234,5 USD …" under an `es` default. The C#
  //      port hardcodes the en-US rule (pinned in contracts/dashboard-fixtures/dashboard-kernels.json,
  //      with tests/parity/dashboard-fixtures.test.ts asserting the runtime default IS en-US). If this
  //      endpoint diffs ONLY inside description strings, check the deployed Node's LANG/LC_ALL before
  //      suspecting the port. This is the same class as the "sept" month divergence, but it is
  //      environmental rather than versioned, so no golden can fully defend it.
  //
  //   7. `search` IS UNEVENLY COVERED BY THE CURRENT SEED, and the weak leg is named here rather than
  //      discovered during a failed run. Its three result arrays fare differently under `query=parity`:
  //        • `organizations` — STRONG. Exactly two rows (`TIMS Parity Harness (__parity_a|b)`), and
  //          `orderBy name asc` has no tie because the names differ. Deterministic.
  //        • `users` — WEAKEST LEG IN THE WHOLE SURFACE, but NOT for the reason first written here.
  //          ~31 seeded users match 'parity' (their emails are all `parity+…@tims.test`), and
  //          `orderBy firstName asc` + `take: 5` sorts them 'Comp'(2) < 'Dei'(10) < 'Enps'(10) <
  //          'Parity'(9). So the window is deterministically the TWO 'Comp' rows plus THREE OF THE TEN
  //          'Dei' rows — and the 'Parity'-named role users, which an earlier version of this caveat
  //          blamed, start at rank 23 (22 rows precede them) and can never appear at all. Two distinct ties remain: WHICH three
  //          'Dei' rows are selected (unfixable by normalization — it changes the row SET), and the
  //          ORDER of the two 'Comp' rows, which share a first name and are compared positionally by
  //          normalize.ts. In practice a seq-scan sort is stable between two calls seconds apart, so it
  //          usually agrees — but a diff confined to `users[*]` should be RE-RUN before it is believed,
  //          and it is the one leg here that could report red on a correct port. (The seeder is
  //          `upsertPublicUser`, not `upsertUser`.)
  //        • `pages` — VACUOUS for this term. No SEARCH_PAGES name or keyword contains "parity", so
  //          both stacks return `[]`. The page-matching kernel (the lower-case asymmetry, the
  //          substring-across-word-boundaries rule, the `.slice(0, 4)` cap) is covered by C# unit and
  //          integration tests instead; this leg asserts only that neither stack invents a page.
  //      The durable fix is a search-specific fixture: two or three users whose first names are DISTINCT
  //      **and sort ahead of 'Comp'**, plus a page-matching term. Distinct-but-later names would change
  //      nothing, since they would land outside the take-5 window. That belongs with the grant-fixture
  //      work #195 tracks, not here.
  //
  // PR 3 (2026-08-15) ADDED THREE ENDPOINTS AND ONE CAVEAT, and the caveat is the surface's most
  // important one because it bounds what a GREEN run on this surface means:
  //
  //   8. THREE OF THE THIRTEEN ENDPOINTS ARE NOT PAYLOAD-COMPARED AT ALL. `kpis`,
  //      `revenue-by-customer` and `churn-risk` carry no `tsProcedure`, so parity reports [WEAK] for
  //      them by design while RBAC and the RLS disposition still assert. They are the three that call
  //      `sumMoney`, and the two stacks resolve rates from DIFFERENT PROVIDERS — live Frankfurter on
  //      the TS side, the DB-pinned `fx_rates` row on the C# side — so their money fields cannot be
  //      made to agree by fixture work. Do not read "verify dashboard: PASS" as covering them.
  //      Their cross-currency behaviour is proven instead by
  //      PlatformDashboardFxEndpointAuthTests, which pins a known rate and asserts the exact
  //      converted wire value. The registry entries carry the full argument, including why seeding
  //      USD-only invoices does not help (these three are platform-wide, so they read every tenant's
  //      invoices — including the two overdue COP ones the live database holds).
  //
  //   9. THESE THREE ARE THE ONLY REGISTERED ENDPOINTS THAT CAN LEGITIMATELY ANSWER 503, and both the
  //      RBAC and the parity legs will call that a FAILURE. `expectedByRole` pins platform_owner: 200,
  //      and `checks/rbac.ts` verdictForRole requires `actual === expected` exactly, so a 503 reports
  //      `expected 200 but got 503`; `checks/parity.ts:26` likewise fails a C#-only endpoint on any
  //      non-200. The trigger is a missing `fx_rates` pin for ANY currency appearing in ANY tenant's
  //      invoices — not just the harness's — because these reads are platform-wide.
  //
  //      So BEFORE reading a red run on these three as a port defect, check the pins:
  //        SELECT DISTINCT currency FROM invoices;
  //        SELECT base_currency, quote_currency, as_of FROM fx_rates;
  //      Every non-USD currency in the first result needs a row in the second. As of 2026-08-15 the
  //      live database satisfies this (invoices are USD and COP; COP is pinned), so the trap is latent
  //      rather than active — but the daily FxRefreshJob is not deployed, so the pin set is frozen and
  //      the FIRST tenant invoiced in a new currency arms it.
  //
  // ALSO PR 3: `seed.ts` now seeds six USD invoices across both orgs. Be precise about what that fixes,
  // because the tempting claim is false. `attention-items` and `customer-health` are PLATFORM-WIDE, so
  // against the live database they were already reading other tenants' invoices and their invoice branches
  // were never empty there. What the seeded rows add is (a) self-sufficiency when the harness is pointed
  // at a locally-seeded database, which cli.ts:191 explicitly contemplates and where those branches WERE
  // empty, and (b) invoice rows belonging to the two orgs this harness authenticates as. That narrows
  // caveat 3's "partly vacuous on empty tables"; it is not a claim that either endpoint was untested.
  //
  // Their due dates are deliberately distinct so the (severity, daysUntil) sort has no new tie to flake
  // on. NOT caveat 4, which is about the two attention sources carrying no `orderBy` AT ALL — the invoice
  // query has one (`orderBy: { dueDate: 'asc' }`, dashboard.ts:139), so it was never in caveat 4's scope.
  //
  // THE FINAL READ (2026-08-16) ADDED `ai-cost-anomalies` — the cluster's thirteenth — AND ONE CAVEAT.
  // Unlike the three FX reads above it IS payload-compared (a `tsProcedure` is registered): both stacks
  // read the SAME three ai-agent tables from the same database and no rate provider is involved, so the
  // caveat-8 argument does not apply to it.
  //
  //  10. `ai-cost-anomalies` IS TIME-DEPENDENT AND TIE-SENSITIVE, in the caveat 1 + caveat 5 shapes at
  //      once, and it can be VACUOUSLY GREEN. Each stack derives its own 30-day window from its own
  //      clock (`Date.now() − 30d`), so a usage row aging out of the window between the two calls flips
  //      an agent+org pair between over-budget and zero-usage — a re-run situation, minutes-level
  //      exposure. The final sort is potentialSavings DESC over the CONFIG row order of an unordered
  //      findMany, so equal-savings anomalies can come back in different orders (the seeded fixtures
  //      use distinct costPerCall values precisely so the harness's own rows never tie). And on a
  //      database with no ENABLED agent configs both stacks return four empty/zero fields comparing
  //      equal — `seedDashboardAiAgents` exists so a locally-seeded database is non-vacuous; against
  //      any other target check `SELECT count(*) FROM ai_agent_org_configs WHERE enabled` before
  //      believing its green. Also worth knowing when reading a diff: the TS type union declares a
  //      third anomaly type, 'high_cost', that NO code path produces — neither stack can emit it, and
  //      a diff showing one would mean the TS side changed. Finally, THE SEEDED OVER-BUDGET LEG
  //      DECAYS: the fixture's usage rows sit at seed-time −5d and −2d, so they age out of the
  //      30-day window at seed+25d and seed+28d — the seeded spend drops 15.5 → 12 at ~25 days
  //      (still over the 10 budget, smaller overage) and org A flips over_budget → zero_usage at
  //      ~28 days, IN BOTH STACKS. Past that flip the harness's own two anomalies are BOTH
  //      zero_usage at 0.5 savings — a TIE, resolved by config scan order the two stacks need not
  //      share, with no normalize — so the run does not merely go dormant on the over-budget branch
  //      and the toFixed(2) detail string: it can flake RED for a non-defect reason (the second-pass
  //      audit corrected the first draft, which claimed it "stays green throughout"). Either way:
  //      if the last seed run is stale, re-seed before reading this endpoint's result.
  dashboard: {
    key: 'dashboard',
    flag: 'Platform__PlatformDashboardReadEnabled',
    roles: ['platform_owner', 'org_admin'],
    // MUST be the role the surface answers 200 to — the #203 defect class; the probeRole-expects-200
    // invariant in surfaces.test.ts asserts it for every surface.
    probeRole: 'platform_owner',
    endpoints: [
      {
        name: 'plan-distribution',
        csharpPath: '/platform/dashboard/plan-distribution',
        tsProcedure: 'platform.getPlanDistribution',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        // One unfiltered cross-org read over subscriptions.plan — no org-specific payload exists, so
        // Mode B's identical-payload heuristic would assert the opposite of the requirement.
        globalScope: true,
        // No normalize: the output order is the TS seed order (trial/starter/professional/enterprise)
        // in BOTH stacks, deterministic regardless of row order, and nothing is nullable. The one real
        // divergence risk on this leg is ROUNDING (JS Math.round vs banker's), and a normalize rule
        // absorbing numbers would hide exactly that.
      },
      {
        name: 'user-growth',
        csharpPath: '/platform/dashboard/user-growth',
        tsProcedure: 'platform.getUserGrowth',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize: six buckets, fixed order, keys `month`/`count`, nothing nullable. The
        // month-boundary straddle (caveat 1) is a re-run situation, not a normalize one.
      },
      {
        name: 'recent-activity',
        csharpPath: '/platform/dashboard/recent-activity',
        tsProcedure: 'platform.getRecentActivity',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize, DELIBERATELY — see caveat 2. The merged DESC order and the orgs-before-users
        // tiebreak are the ported kernel; `sortArraysBy` would stop comparing them. `meta` is always
        // present in practice (org plan / user email, both NOT NULL), so a null there is unreachable;
        // `dropNullish` is still declined, because it would also mask any FUTURE nullable this payload
        // grows. (An earlier version of this comment said dropNullish would mask a C# `meta: null`
        // "where TS omits the key". That mechanism is wrong: the response is serialised by superjson,
        // whose `json` payload — the half stripTrpcJson hands to the differ — renders a written-but-
        // undefined property as `null`, not as an absent key. The conclusion is unchanged.)
      },
      // ── PR 2 (2026-08-14): the six remaining FX-free reads, same flag, same platform-owner shape ──
      {
        name: 'attention-items',
        csharpPath: '/platform/dashboard/attention-items',
        tsProcedure: 'platform.getAttentionItems',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize. The (severity, daysUntil) ordering IS the kernel this endpoint exists to
        // compare, so `sortArraysBy` would gut the diff — and `dropNullish` would hide the one place
        // this payload legitimately carries nulls (an org-less stale invitation's orgId/orgName), which
        // is exactly the field pair most likely to be got wrong. See caveat 4 for the flake risk this
        // choice leaves standing.
      },
      {
        name: 'mrr-trend',
        csharpPath: '/platform/dashboard/mrr-trend',
        tsProcedure: 'platform.getMrrTrend',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize: twelve buckets, fixed order, keys `month`/`mrr`, nothing nullable. Shares
        // caveat 1's month-boundary exposure (the twelve buckets end at the CURRENT month).
      },
      {
        name: 'mrr-forecast',
        csharpPath: '/platform/dashboard/mrr-forecast',
        tsProcedure: 'platform.getMrrForecast',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize. `planBreakdown` is an OBJECT whose key order is unspecified in both stacks
        // (TS inserts in the row order of an unordered findMany), and that is FINE without a rule:
        // normalize.ts's `diff` walks a key-set union rather than comparing serialised text, so object
        // key order is already not compared. Also shares caveat 1.
      },
      {
        name: 'customer-health',
        csharpPath: '/platform/dashboard/customer-health',
        tsProcedure: 'platform.getCustomerHealth',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize, and this is the one where a `sortArraysBy: 'orgId'` rule is genuinely tempting
        // — see caveat 5. It is declined because the health BAND ordering is the kernel; sorting by
        // orgId would stop comparing it entirely.
      },
      {
        name: 'upsell-opportunities',
        csharpPath: '/platform/dashboard/upsell-opportunities',
        tsProcedure: 'platform.getUpsellOpportunities',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize: the mrrIncrease-descending sort is the kernel, and every field is non-null.
        // Ties on mrrIncrease keep source order (an unordered findMany) in both stacks — caveat 5
        // again, in a milder form, since only orgs on the SAME plan can tie.
      },
      {
        name: 'search',
        // The ONLY dashboard endpoint with an input. `csharpPath` carries its own query string (the
        // harness substitutes only the `{id}` sentinel), and `input` is what the TS procedure receives —
        // the two must agree or the stacks are answering different questions; surfaces.test.ts asserts
        // they do, because nothing else in the registry cross-checks them.
        //
        // The term is 'parity' because that is what the harness's own seed actually contains: both
        // organizations are named `TIMS Parity Harness (__parity_<a|b>)` with slug `__parity_<a|b>`, and
        // every seeded user's email is `parity+<a|b>-<role>@tims.test`. Read the seed before changing
        // it — a term that matches nothing turns this endpoint into two empty payloads comparing equal,
        // which is a PASS that proves nothing. See caveat 7 for what this term does and does not cover.
        csharpPath: '/platform/dashboard/search?query=parity',
        tsProcedure: 'platform.search',
        input: { query: 'parity' },
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize: `orderBy name/firstName asc` is a database sort, so both stacks get the same
        // order from the same collation. `dropNullish` is declined because `avatar` and the nested
        // `organization` are exactly the nullable fields worth comparing — an org-less platform owner
        // must show `organization: null` on both sides.
      },
      // ── PR 3 (2026-08-15): the three FX-DERIVED reads, C#-ONLY ON PURPOSE ─────────────────────
      //
      // These three have NO `tsProcedure`, and that omission is the whole decision — parity prints
      // an explicit [WEAK] did-not-run for them while `checks/rbac.ts` (org_admin 403 / platform_owner
      // 200 against the LIVE C# route) and the RLS disposition keep asserting.
      //
      // NOT the same treatment as `dei.getPayEquity` or compensation's three FX reads, and the difference
      // is the point: those are NOT REGISTERED AT ALL (this file calls pay-equity "DELIBERATELY EXCLUDED"
      // further down, and surfaces.test.ts asserts its absence), so they get no RBAC deny assertion and no
      // liveness check either. Registered-C#-only is the STRONGER disposition — the one nine-box,
      // audit-log, access-review and dei's two survivors ended up with — and it is what
      // `EndpointDef.tsProcedure`'s contract at the top of this file exists to enable. Their exclusion also
      // had a different CAUSE (a separate `Platform__FxReadsEnabled` flag plus a deleted TS side), not a
      // provider mismatch. The reason here is its own:
      //
      //   THE TWO STACKS RESOLVE RATES FROM DIFFERENT PROVIDERS, so a numeric comparison cannot be
      //   made to agree by any amount of fixture work. TS calls LIVE Frankfurter (ECB) per request;
      //   C# reads the DB-pinned `fx_rates` row (exchangerate-api, written by a refresh job that is
      //   not currently deployed — every pin in production still carries as_of 2026-07-31).
      //
      // The seductive wrong answer, written down so it is not re-attempted: "seed USD-only invoices
      // so both stacks take the identity path and never call a rate provider." That works for the
      // HARNESS's own rows and does nothing for these endpoints, because all three are PLATFORM-WIDE
      // — they sum every tenant's invoices, not the two orgs this harness owns. Measured against the
      // live database on 2026-08-15: two overdue COP invoices totalling 8,250,000 COP. The pin turns
      // those into 3826.61 USD of `outstandingAmount`; TS turns them into whatever COP has done in the
      // fifteen days since. Registering a `tsProcedure` would produce a permanent FAIL that is not a
      // port defect — the #166 shape, where a fixture gap read as a product bug.
      //
      // `scripts/parity/seed.ts` DOES now seed six USD invoices, and they are worth having anyway:
      // until PR 3 the harness seeded none at all, so `getAttentionItems` and `getCustomerHealth`
      // were comparing two empty invoice branches. Those two endpoints get stronger here; these three
      // do not become comparable.
      //
      // What would make them comparable is unifying the rate source (or retiring non-USD billing),
      // neither of which belongs to this slice. Until then, DELETING these three entries would be the
      // regression — it would retire the RBAC deny assertions on three live-in-repo routes.
      {
        name: 'kpis',
        csharpPath: '/platform/dashboard/kpis',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize — and here the absence is nearly moot, since no payload diff runs at all. It
        // is still declined explicitly so that RE-adding a tsProcedure later (if the rate sources are
        // ever unified) does not silently inherit a rule nobody argued for.
      },
      {
        name: 'revenue-by-customer',
        csharpPath: '/platform/dashboard/revenue-by-customer',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
      {
        name: 'churn-risk',
        csharpPath: '/platform/dashboard/churn-risk',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
      },
      // ── The FINAL read (2026-08-16): ai-cost-anomalies, the cluster's thirteenth ──────────────
      {
        name: 'ai-cost-anomalies',
        csharpPath: '/platform/dashboard/ai-cost-anomalies',
        // A REAL payload diff, unlike the three FX entries above: both stacks read the same three
        // ai-agent tables from the same database — no rate provider, so caveat 8 does not apply.
        tsProcedure: 'platform.getAiCostAnomalies',
        input: {},
        expectedByRole: { platform_owner: 200, org_admin: 403 },
        globalScope: true,
        // No normalize: the potentialSavings-descending sort IS the kernel (sortArraysBy would stop
        // comparing it), and `monthlyBudget: null` — which every budget-less zero-usage anomaly
        // carries — is exactly the field dropNullish would hide. See caveat 10 for the rolling-window
        // and tie exposure this leaves standing.
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
  // WHY THIS IS NOT DELETED — the reasoning that, one by one, un-deleted the others. (audit-log
  // and access-review were RE-REGISTERED C#-only on 2026-08-11 on exactly the reasoning below, and
  // succession/team-intel/reporting/evaluation360 followed on 2026-08-17 (#195) — see their
  // entries. Of the once-deleted read surfaces only billing-read/billing-usage remain deleted.)
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
  // ── The four talent read surfaces, RE-REGISTERED C#-only (2026-08-17, #195 residual) ────────
  // succession / team-intel / reporting / evaluation360 below were all registered in the original
  // harness build-out (#177/#186/#187/#189), then DELETED in the 2026-07-29..08-03 TS-deletion
  // passes on the reasoning "the TS procedures are gone, so there is nothing left to diff" —
  // succession last, on 2026-08-03 (#58), when its router was deleted outright. That reasoning did
  // not survive `tsProcedure` becoming OPTIONAL on 2026-08-06 (efb7553f): omitting the field keeps
  // an endpoint registered, parity reports [WEAK] with a reason, and the RBAC deny assertions +
  // RLS probes keep running against the live C# routes — the audit-log / access-review
  // re-registration rationale (2026-08-11), which could not yet cover these four because each is
  // org-scoped RBAC and needs its own seeded grant fixture (#166's false-FAIL lesson). Those
  // fixtures have existed in seed.ts since the original registrations and are STILL WIRED into
  // seed() — seedTeamIntelGrants+Data, seedReportingGrants+Data, seedSuccessionGrants+Data,
  // seedEvaluation360Grants+Data, plus seedOrgBTier2Mirrors for every by-id positive control —
  // verified against seed()'s call sites on 2026-08-17, not assumed.
  //
  // Role expectations are COPIED from the deleted registrations (git 0a368681, the fullest
  // pre-deletion registry) WHERE ONE EXISTED, and re-checked against the four C# gates. The
  // panel counted the set: 0a368681 registered team-intel with ONE endpoint (dashboard-kpis), so
  // the other four team-intel entries below (compare / profile / members / balance-score) have NO
  // prior registration to copy from — their expectations are SOURCE-DERIVED ONLY (gate + grant
  // fixture), which is the weaker provenance and the first place a live `verify team-intel` run
  // should look if it reds. Verified
  // 2026-08-17: packages/api/src/routers contains no teamIntel / succession / evaluation360 /
  // recruitmentAnalytics router (only team-intel-metrics.ts survives, a kernel re-export), so no
  // endpoint below carries a `tsProcedure`, and NONE carries `normalize` — with no payload diff a
  // rule would be dead weight now and an unargued inheritance if a TS side ever returned (the
  // dashboard `kpis` entry's reasoning).
  //
  // billing-read / billing-usage remain the two surfaces still deleted on the old reasoning —
  // allowlisted in tests/governance/parity-registry-covers-deployed-routes.test.ts, tracked in
  // #195. cutover.sh's rows for the four re-registered surfaces (team-intel / reporting /
  // succession / evaluation360 read) were flipped NONE→verify (and
  // README-cutover.md with them — tests/governance/cutover-table-matches-script.test.ts pins the
  // two together) in this same PR, so --verify-only is a real gate for them again.
  //
  // THE WIDER GAP NARRATIVE that used to live here (135 deployed ops / 50 registered / gap 85,
  // measured 2026-08-11) lives with the numbers now: the route-coverage guard
  // (tests/governance/parity-registry-covers-deployed-routes.test.ts) pins the current measurement
  // — 151 deployed operations, 92 registered endpoints, 59 allowlisted with a reason per group as
  // of this change — and fails if a NEW deployed route appears in neither set. The gap still
  // includes whole domains never registered (external-vendor, billing self-serve/webhook writes,
  // `/internal/alert-metrics`) plus most routes inside surfaces that ARE registered (engagement 2
  // of 14 deployed GETs; dei 2 of 11; compensation 2 of 12; ninebox 4 of 11 — measured
  // 2026-08-11). Do not read "the surface is registered" as "the domain is covered". #195 tracks.
  //
  // ── team-intel (READ, C#-only) ──────────────────────────────────────────────────────────────
  // FIVE of the seven deployed routes behind Platform__TeamIntelReadEnabled
  // (TeamIntelReadEndpoints.cs). Gate: TeamIntelStaffGate (team_intel:read via the shared
  // PermissionService kernel) RETURNS the resolved scope and each endpoint applies its own
  // mechanic — a ScopedProbe team IDOR probe (404-not-403, never confirms the id) on the by-id
  // trio, scopeWhereFor('team') composed into `compare`, OrgGate on `dashboard-kpis`.
  //
  // RBAC (seedTeamIntelGrants: hr_admin team_intel:read@organization; hrbp INTENTIONALLY holds no
  // team_intel grant — its 403 is the deny proof, as the original registration designed):
  // super_admin 200 (code-guaranteed bypass in PermissionService), hr_admin 200 (real grant),
  // hrbp 403 on EVERY endpoint — a grant-level deny at the gate, which runs BEFORE the by-id
  // probe, so it is deterministic on the by-id trio too.
  //
  // THE TWO ROUTES NOT REGISTERED — balance-alerts + recommended-hires — are DEPLOYED HONEST 501
  // STUBS (TeamIntelReadEndpoints.cs: gate → team probe → 501, "AI agent pending"). NO role
  // receives a 200 from them, and the harness contract cannot express that: `expectedByRole`
  // admits only 200|403, checks/parity.ts fails a C#-only endpoint on any non-200, the
  // probeRole-expects-200 invariant (surfaces.test.ts) covers every endpoint of a surface, and
  // the Mode-A positive control requires the org-B caller to reach its own resource 200 +
  // non-empty. Registering them would manufacture a permanent false-RED — the #166 shape, which
  // that allowlist's own group-2 reason calls worse than a documented gap. They stay allowlisted
  // (tests/governance/parity-registry-covers-deployed-routes.test.ts, their own group) and their
  // gate→probe→501 ordering is pinned by TeamIntelReadEndpointAuthTests.cs. When the AI agents
  // ship and they answer 200, register them HERE as by-id endpoints (idScopeKey 'team').
  //
  // ⚠️ TWO CAVEATS, stated rather than discovered at run time:
  //   1. `compare`'s RLS Mode B is VACUOUS BY DESIGN. Its two teamIds are FIXED NON-EXISTENT
  //      uuids (the access-review fixed-id precedent): scopeWhereFor silently drops unknown /
  //      out-of-scope ids, so BOTH orgs answer `{teams: []}` — deep-empty — and Mode B reports the
  //      documented both-empty inconclusive, never a spurious identical-payload FAIL. Real ids
  //      cannot be expressed: the harness substitutes exactly ONE id (the `{id}` sentinel), a
  //      compare needs 2..5, and rls.ts's buildProbePath replaces only the FIRST `{…}` token. What
  //      this registration buys for `compare` is the RBAC matrix + liveness; the by-id trio
  //      carries the surface's real Mode-A IDOR probes.
  //   2. `members`' Mode-A positive control DEPENDS on the seedOrgBTier2Mirrors membership
  //      (b:hr_admin ∈ 'Parity Team B1'): an org-B team with no members answers its own org
  //      200-with-[], which is deep-empty and FAILS the control. Re-seed before reading a
  //      `members` RLS FAIL as a product bug.
  'team-intel': {
    key: 'team-intel',
    flag: 'Platform__TeamIntelReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    // Same probe identity the deleted registration used: org-scoped and code-guaranteed 200 in
    // both orgs, so the Mode-A positive control (org-B token → org-B team) cannot fail on a grant.
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'dashboard-kpis',
        csharpPath: '/team-intel/dashboard-kpis',
        // tsProcedure omitted: teamIntel.getDashboardKpis was deleted (381f0a2b) with its router.
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        // Fixed non-existent teamIds — see caveat 1. Query string and `input` carry the SAME two
        // ids (callers use csharpPath verbatim; input mirrors the old Zod array shape).
        name: 'compare',
        csharpPath:
          '/team-intel/compare?teamIds=e0000006-0000-4000-8000-000000000001&teamIds=e0000006-0000-4000-8000-000000000002',
        input: { teamIds: ['e0000006-0000-4000-8000-000000000001', 'e0000006-0000-4000-8000-000000000002'] },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      // Tier-2 by-id trio — the surface's real cross-tenant probes. Org-A id = 'Parity Team A1'
      // (leader + 1 member); org-B IDOR target = 'Parity Team B1' (resolveResources 'team', by
      // (org, name) — teams carry generated ids). Cross-tenant status is the probe's 404.
      {
        name: 'profile',
        csharpPath: '/team-intel/teams/{id}/profile',
        input: { teamId: ID_SENTINEL },
        idScopeKey: 'team',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'members',
        csharpPath: '/team-intel/teams/{id}/members',
        input: { teamId: ID_SENTINEL },
        idScopeKey: 'team',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'balance-score',
        csharpPath: '/team-intel/teams/{id}/balance-score',
        input: { teamId: ID_SENTINEL },
        idScopeKey: 'team',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
    ],
  },
  // ── reporting (READ, C#-only) ───────────────────────────────────────────────────────────────
  // All SIX deployed routes behind Platform__ReportingReadEnabled (ReportingReadEndpoints.cs).
  // Gate: ReportingStaffGate = vacancy:read grant THEN requireOrgScope (OrgGate) — forced for
  // every endpoint, because these are org-wide recruitment aggregates.
  //
  // RBAC (seedReportingGrants): hr_admin vacancy:read@organization → 200 (a real grant clearing
  // OrgGate); hrbp vacancy:read@UNIT → 403 on every endpoint, and that 403 exercises the REAL
  // requireOrgScope path (grant held, scope too narrow) rather than a bare no-grant deny;
  // super_admin 200 (bypass). All copied from the deleted registration, whose header derived them
  // from seed-access-matrix.ts.
  //
  // RLS: all six are org-scoped Mode B. seedReportingData populates org A ONLY (org B empty), so
  // the fixed-shape reads differ A-non-zero vs B-all-zero and the array reads are A-non-empty vs
  // B-empty — real comparisons, not inconclusive greens.
  //
  // ⚠️ CAVEATS:
  //   1. TIME-RELATIVE WINDOWS (30D on kpis/source-breakdown/lost-by-delay; 6 UTC calendar months
  //      on trend). The seed re-anchors every date to now() on each re-run and every row sits ≤20
  //      days back — but a STALE seed lets rows age out of the 30D window, draining org A's
  //      payloads toward org B's zeros (statuses hold; the Mode B comparison weakens toward
  //      inconclusive). Re-seed before a run — the ai-cost-anomalies discipline.
  //   2. The deleted registration carried a SECOND kpis probe at period=90D (to catch a port that
  //      ignored the query param). DELIBERATELY NOT RESTORED: it normalises to the same VERB+path
  //      key as `kpis`, which the route-coverage guard's injectivity pin forbids — and with no
  //      tsProcedure there is no payload diff for a second window to strengthen; a second
  //      liveness-200 on the same route proves nothing. Window handling is covered by the C#
  //      Reporting tests instead.
  //   3. The period is BAKED into csharpPath AND mirrored in `input` (callCsharp uses csharpPath
  //      verbatim). Keep the two agreeing when editing either.
  reporting: {
    key: 'reporting',
    flag: 'Platform__ReportingReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'kpis',
        csharpPath: '/reporting/kpis?period=30D',
        // tsProcedure omitted here and on all five below: the recruitmentAnalytics router was
        // deleted (81b5e591) — C#-only, parity reports [WEAK] by design.
        input: { period: '30D' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'funnel',
        csharpPath: '/reporting/funnel',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'source-breakdown',
        csharpPath: '/reporting/source-breakdown?period=30D',
        input: { period: '30D' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'trend',
        csharpPath: '/reporting/trend',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'lost-by-delay',
        csharpPath: '/reporting/lost-by-delay?period=30D',
        input: { period: '30D' },
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'recruiter-sla',
        csharpPath: '/reporting/recruiter-sla',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
    ],
  },
  // ── succession (READ, C#-only) ──────────────────────────────────────────────────────────────
  // All NINE deployed reads behind Platform__SuccessionReadEnabled (SuccessionReadEndpoints.cs).
  // This closes the standing debt recorded in this spot since 2026-08-11: the deletion note that
  // used to stand here called `verify succession` "a NO-OP" and a genuine coverage reduction — it
  // is a real check again (RBAC + RLS; parity is [WEAK] by design, the TS router is deleted, #58).
  //
  // Gate: SuccessionStaffGate (succession:read) RETURNS the scope; each endpoint applies its own
  // mechanic — a scopeWhereFor row filter on the list, a ScopedProbe critical-role IDOR probe
  // (404-not-403) on the by-id trio, OrgGate on the five org-rollups. comp-gap-alerts adds a
  // SECONDARY compensation:read check plus a scoped comp row filter.
  //
  // RBAC (seedSuccessionGrants: hr_admin succession:read@org, hrbp @unit; hr_admin's
  // compensation:read@org — the comp-gap secondary — comes from seedCompensationGrants):
  //   super_admin / hr_admin → 200 everywhere. hrbp is THREE dispositions, each deliberate:
  //   200 on the LIST (unit-scoped grant → scoped-empty rows — the faithful behaviour the deleted
  //   entry asserted), 403 on the five ORG-ROLLUPS (the real requireOrgScope deny), and OMITTED
  //   from the by-id trio (the ScopedProbe answers its out-of-scope probe 404, which `200|403`
  //   cannot express and which is not an RBAC-permission signal — the deleted entry's reasoning).
  //   org_admin — NEW relative to the deleted entry — is the surface's uniform GRANT-LEVEL deny:
  //   absent from seed-access-matrix's MATRIX and holding no seeded grants, PermissionService
  //   itself refuses it 403 on all nine (before the probe on the by-id trio, so deterministic).
  //   Without it, the list and the by-id trio would carry NO denied role at all — the monitoring
  //   precedent, applied for the same reason.
  //
  // RLS: six Tier-1 Mode B (org-A dataset vs org B's single mirror critical role — every read
  // differs across orgs) + three by-id Mode A threading `critical-role` ('Parity Critical Role
  // A1'/'B1'). The org-B suggested-successors positive control is fed by b:hr_admin's
  // high_potential nine-box eval (seedOrgBTier2Mirrors seeds it for exactly this).
  //
  // ⚠️ SIDE EFFECT, the access-review precedent's shape but with inserts that LAND: comp-gap-alerts
  // audits every EXPOSED employeeCompensation row into data_access_logs FAIL-CLOSED before
  // responding, so every `verify succession` run writes a few data_access_logs rows attributed to
  // the parity actors (the org exists, unlike access-review's all-zeros org, so nothing rejects
  // them). They carry soft references only (no FK — audit rows survive user deletion, by design),
  // so teardown neither breaks on them nor sweeps them: harmless residue in a scratch database,
  // but a command read as non-mutating must have this written down.
  succession: {
    key: 'succession',
    flag: 'Platform__SuccessionReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp', 'org_admin'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'critical-roles',
        csharpPath: '/succession/critical-roles',
        // tsProcedure omitted here and on all eight below: the succession router was deleted
        // outright on 2026-08-03 (#58) — C#-only, parity reports [WEAK] by design.
        input: {},
        // hrbp 200 = scoped-EMPTY rows (unit grant), the faithful disposition the deleted entry
        // asserted; org_admin is the deny that keeps this endpoint off the no-denial list.
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200, org_admin: 403 },
      },
      {
        name: 'flight-risk',
        csharpPath: '/succession/flight-risk',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403, org_admin: 403 },
      },
      {
        name: 'competency-coverage',
        csharpPath: '/succession/competency-coverage',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403, org_admin: 403 },
      },
      {
        name: 'roles-without-successor',
        csharpPath: '/succession/roles-without-successor',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403, org_admin: 403 },
      },
      {
        name: 'comp-gap-alerts',
        csharpPath: '/succession/comp-gap-alerts',
        input: {},
        // hrbp's 403 comes from the org-rollup gate BEFORE the secondary compensation check runs;
        // org_admin's from the succession grant itself. See the surface header for the
        // data_access_logs side effect this endpoint carries on every allowed call.
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403, org_admin: 403 },
      },
      {
        name: 'dashboard-kpis',
        csharpPath: '/succession/dashboard-kpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403, org_admin: 403 },
      },
      // Tier-2 by-id trio: assertScoped('criticalRole') probes 404-not-403 for out-of-scope, so
      // hrbp (unit scope, empty anchors) is OMITTED — 404 is not expressible and not a permission
      // signal. Org-A target = 'Parity Critical Role A1' (holder a:super_admin, one ready-now
      // successor); Mode-A IDOR target = org-B 'Parity Critical Role B1'. NOTE the input param
      // names differ per route (`id` vs `criticalRoleId`), preserved from the deleted entries.
      {
        name: 'critical-role',
        csharpPath: '/succession/critical-roles/{id}',
        input: { id: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200, org_admin: 403 },
      },
      {
        name: 'suggested-successors',
        csharpPath: '/succession/critical-roles/{id}/suggested-successors',
        input: { criticalRoleId: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200, org_admin: 403 },
      },
      {
        name: 'simulate-exit',
        csharpPath: '/succession/critical-roles/{id}/simulate-exit',
        input: { criticalRoleId: ID_SENTINEL },
        idScopeKey: 'critical-role',
        expectedByRole: { super_admin: 200, hr_admin: 200, org_admin: 403 },
      },
    ],
  },
  // ── evaluation360 (READ, C#-only) ───────────────────────────────────────────────────────────
  // All FIVE deployed reads behind Platform__Evaluation360ReadEnabled
  // (Evaluation360ReadEndpoints.cs). TWO AUTH PATTERNS, deliberately never crossed, and the
  // expectations below differ accordingly:
  //   STAFF (cycles, cycle-progress): Evaluation360StaffGate = evaluation360:read + OrgGate.
  //     hr_admin@org (seedEvaluation360Grants) → 200; hrbp holds NO evaluation360 grant (the
  //     matrix omits the module — admin cycle reads are org-only) → 403, a grant-level deny;
  //     super_admin 200 (bypass).
  //   SELF-SERVICE (my-rater-tasks, my-report-cycles, my-report): Evaluation360SelfServiceGate =
  //     IDENTITY ONLY. Any resolved principal passes, the queries hard-filter on the caller's own
  //     user id, and the gate HAS NO 403 PATH AT ALL (401-for-unresolvable is its only failure).
  //     So the three self-service endpoints structurally CANNOT carry a 403 expectation — they sit
  //     on surfaces.test.ts's documented no-denial list, and what their registration asserts is
  //     the status matrix, liveness, and the RLS probes; the not-yours behaviour (a 404
  //     indistinguishable from not-published, by design) is pinned by the C# Evaluation360 tests.
  //   my-report additionally answers that 404 to ANY caller who is not a published subject, so
  //     hr_admin/hrbp cannot appear in its map at all: only super_admin — the pubA/pubB published
  //     self-subject the fixtures seed — is asserted. Copied from the deleted entry.
  //
  // probeRole super_admin is LOAD-BEARING here, not a stylistic default: seedOrgBTier2Mirrors
  // builds the org-B positive controls around b:super_admin — the openB non-self rater assignment
  // (progress counts exclude the CALLER's own subject-assignments, and b:super is the RATER there)
  // and the pubB published self-subject + response (my-report). A different probe identity would
  // fail the Mode-A controls for a fixture reason, not a product one.
  //
  // Min-3 note: with ONE seeded response, my-report's buckets are suppressed-by-omission in both
  // stacks; the view still carries cycleId/cycleName, so the positive control's non-empty
  // requirement holds regardless.
  evaluation360: {
    key: 'evaluation360',
    flag: 'Platform__Evaluation360ReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'cycles',
        csharpPath: '/evaluation360/cycles',
        // tsProcedure omitted here and on all four below: the evaluation360 router's five read
        // procedures were deleted with the TS-deletion passes — C#-only, parity [WEAK] by design.
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      // Tier-2 by-id (STAFF): org-A target = the openA cycle (super is a RATER there, so the
      // caller-excludes-own-subject-assignments rule leaves its counts non-empty); Mode-A IDOR
      // target = openB. An unknown/cross-org cycle is 404 (null → NotFound), so isolation reads
      // as a clean denial.
      {
        name: 'cycle-progress',
        csharpPath: '/evaluation360/cycles/{id}/progress',
        input: { cycleId: ID_SENTINEL },
        idScopeKey: 'eval-cycle-staff',
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
      },
      {
        name: 'my-rater-tasks',
        csharpPath: '/evaluation360/my/rater-tasks',
        input: {},
        // Self-service: any resolved principal → 200 (its own tasks; empty for hr_admin/hrbp).
        // All-200 by construction — on the documented no-denial list, see the surface header.
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
      },
      {
        name: 'my-report-cycles',
        csharpPath: '/evaluation360/my/report-cycles',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 200 },
      },
      // Tier-2 by-id (SELF-SERVICE): org-A target = pubA (super is the published self-subject);
      // Mode-A IDOR target = pubB. hr_admin/hrbp are NOT subjects of pubA → 404, which `200|403`
      // cannot express — so only super_admin is asserted (the deleted entry's exact shape).
      {
        name: 'my-report',
        csharpPath: '/evaluation360/my/reports/{id}',
        input: { cycleId: ID_SENTINEL },
        idScopeKey: 'eval-cycle-self',
        expectedByRole: { super_admin: 200 },
      },
    ],
  },
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
  // read could not use this trick and needed a real seeded id plus the `noTenantBoundaryForCaller`
  // marker instead. (This sentence read "...which is why THAT read is still unregistered ~200 lines
  // above" until 2026-08-11; it was registered in the same change that added the marker.)
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
  // A version of this surface bound to a REAL org id would need the by-id platform-owner marker
  // `noTenantBoundaryForCaller` (which now exists — `getOrganization` uses it); it must not simply
  // inherit `globalScope` from here.
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
  // got, and that audit-log / access-review got, before all but the two billing surfaces were
  // re-registered C#-only (2026-08-11 for those two, 2026-08-17 / #195 for the four talent
  // surfaces) — would silently retire that RBAC + RLS coverage, which
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
