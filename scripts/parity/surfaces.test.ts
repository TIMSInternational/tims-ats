import { describe, it, expect } from 'vitest';
import { SURFACES } from './surfaces';

describe('SURFACES', () => {
  // 2026-08-03 (#58): was "the three read surfaces" — succession dropped out when its last
  // TS-backed endpoint (getCriticalRole) was deleted. 2026-08-05 (#57): ninebox dropped out the same
  // way (its last 4 TS-backed endpoints deleted with the whole router). Both — and the other three
  // talent surfaces — are registered C#-only today (succession/team-intel/reporting/evaluation360
  // re-registered 2026-08-17, #195); see the dedicated assertions below. compensation is still the
  // only talent read surface with a TS side left.
  it('the one read surface that still has a TS side is registered with its flag + current endpoint set (Tier-1 + Tier-2 by-id)', () => {
    expect(SURFACES['compensation'].flag).toBe('Platform__CompensationReadEnabled');
    // 2026-07-29: shrunk from 7 to 2 — the other 5 TS procedures were deleted (C#-only now).
    expect(SURFACES['compensation'].endpoints.map((e) => e.name).sort()).toEqual(['employee', 'market-comparison']);
    expect(SURFACES['compensation'].probeRole).toBe('super_admin');
  });

  // ── Registry-level invariants (added 2026-08-11) ─────────────────────────────────────────────
  // These three did not exist before, and their absence let a real defect ship: #203 registered
  // `organization` with probeRole 'org_admin', a role the surface answers 403 to, which makes
  // `verify organization` fail both parity legs and CRASH the TS one (trpc.ts:11 throws on a tRPC
  // error). Nothing caught it because every guard here was per-surface and hand-written.
  //
  // write-surfaces.test.ts's registry pin carried a comment claiming this file "already guards
  // against [that] on the read side". It did not — there was no Object.keys(SURFACES) assertion at
  // all. That comment is corrected there; these are the guards it was describing.

  it('pins the registered read surfaces — adding or DELETING one must be deliberate', () => {
    // The read-side analogue of write-surfaces.test.ts's key-set pin. Deleting a surface is how the
    // access-review and audit-log coverage silently vanished for eleven days in 2026; the per-surface
    // describes below could not catch it, because a deleted surface takes its own test with it.
    expect(Object.keys(SURFACES).sort()).toEqual([
      'access-review',
      'audit-log',
      'compensation',
      // NEW 2026-08-14 (Phase-5 slice 23, #81 PR 1) — the platform-owner dashboard read surface (the
      // three FX-free reads), registered in the same PR that deployed its three routes.
      'dashboard',
      'dei',
      'engagement',
      // RE-REGISTERED 2026-08-17 (#195 residual), C#-only, with 'reporting'/'succession'/'team-intel'
      // below — the four talent read surfaces deleted in the 2026-07-29..08-03 TS-deletion passes,
      // restored on the audit-log/access-review rationale now that their grant+data fixtures are
      // verified wired into seed().
      'evaluation360',
      // NEW 2026-08-12 (Phase-5 slice 22, #75) — the platform-owner invitations read surface, registered
      // in the same PR that deployed its three routes.
      'invitation',
      'monitoring',
      'ninebox',
      'organization',
      'reporting', // re-registered 2026-08-17 (#195) — see 'evaluation360' above.
      'succession', // re-registered 2026-08-17 (#195) — see 'evaluation360' above.
      'team-intel', // re-registered 2026-08-17 (#195) — see 'evaluation360' above.
    ]);
  });

  it('every surface probes with a role it actually grants 200 — the #203 defect class', () => {
    // THE invariant. `runChecks` (cli.ts) calls BOTH stacks with the probeRole's token and expects
    // success — the `csharpCaller`/`tsCaller` pair it builds for the parity loop. checks/parity.ts:
    // 49-56 fails closed on a non-200 C# response, and on the TS side stripTrpcJson (trpc.ts:11)
    // THROWS on an error response, taking the whole run down rather than reporting a FAIL. So a
    // probeRole the surface denies does not degrade the check — it destroys it.
    //
    // This checks the REGISTRY AGAINST ITSELF and cannot see a registry that is internally
    // consistent and wrong about the PRODUCT. checks/preflight.ts (#206) covers that at run time.
    for (const [key, surface] of Object.entries(SURFACES)) {
      const probe = surface.probeRole;
      expect(probe, `${key} has no explicit probeRole`).toBeDefined();
      expect(surface.roles, `${key}: probeRole "${probe}" is not in roles`).toContain(probe);
      for (const ep of surface.endpoints) {
        expect(
          ep.expectedByRole[probe!],
          `${key}/${ep.name}: probeRole "${probe}" expects ${ep.expectedByRole[probe!]}, but the parity probe requires 200`,
        ).toBe(200);
      }
    }
  });

  it('an endpoint with no DENIED role is on a documented list — its RBAC check proves nothing', () => {
    // Generalised from the monitoring-specific version below. An all-200 matrix cannot distinguish
    // "the permission check ran and allowed" from "no permission check ran" — every assertion reads
    // "200 means allowed".
    //
    // Five endpoints are in that state TODAY. That is pre-existing and NOT fixed here: inventing a
    // denial without checking what the product actually returns would assert a behaviour rather than
    // observe one, and a wrong 403 expectation fails a real verify run in Federico's hands. So this
    // is an allowlist, not a pass — a NEW all-200 endpoint has to be added here deliberately, and
    // adding one is the signal to go find its denied role.
    const knownNoDenial = [
      'compensation/market-comparison', // grant-only org catalogue read; all three seeded roles hold it
      'ninebox/movement-history', // only two roles registered at all
      'ninebox/simulate', // pure kernel
      'ninebox/quadrant-plan', // pure kernel
      'engagement/surveys', // grant-only list; hrbp@unit passes deliberately (see the surface note)
      // The three evaluation360 SELF-SERVICE reads (2026-08-17, #195). Their gate
      // (Evaluation360SelfServiceGate) authorizes on IDENTITY alone and HAS NO 403 PATH — any
      // resolved principal passes and the queries hard-filter on the caller's own user id — so no
      // role CAN be denied; this is structural, not a missing fixture. my-report's not-yours
      // behaviour is a 404 (indistinguishable from not-published, by design), asserted by the C#
      // Evaluation360 tests rather than by an expectation `200|403` cannot express.
      'evaluation360/my-rater-tasks',
      'evaluation360/my-report-cycles',
      'evaluation360/my-report', // only super_admin (the seeded published self-subject) is asserted
    ];
    const actual: string[] = [];
    for (const [key, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (Object.values(ep.expectedByRole).every((v) => v !== 403)) actual.push(`${key}/${ep.name}`);
      }
    }
    expect(actual.sort()).toEqual(knownNoDenial.sort());
  });

  it('every Tier-2 by-id endpoint sets idScopeKey and carries the {id} sentinel in path + input', () => {
    // The by-id Mode-A IDOR endpoints and the resource key each threads.
    // 2026-08-03 (#58): 'succession/critical-role' removed with the surface.
    // 2026-08-05 (#57): 'ninebox/axis-breakdown' RETAINED — its TS side went, the endpoint did not.
    const expected: Record<string, string> = {
      'compensation/employee': 'employee',
      // C#-only after #57 (no tsProcedure), but STILL by-id and still the surface's cross-tenant
      // IDOR probe — which is exactly why the nine-box surface was kept rather than deleted.
      'ninebox/axis-breakdown': 'employee',
      // #195, 2026-08-11. By-id like the two above, but it runs NO Mode-A probe: it carries
      // `noTenantBoundaryForCaller`, so checks/rls.ts short-circuits to a documented N/A. The
      // sentinel/idScopeKey requirements asserted below still apply to it unchanged — it still has to
      // bind a REAL seeded org id for parity and RBAC.
      'organization/detail': 'organization',
      // #195 residual, 2026-08-17 — the four re-registered C#-only surfaces' Mode-A probes. The
      // 'team' pair is NEW in SeedResources ('Parity Team A1'/'B1'); 'critical-role' and the two
      // eval-cycle pairs are the keys the DELETED registrations threaded, re-consumed unchanged.
      'team-intel/profile': 'team',
      'team-intel/members': 'team',
      'team-intel/balance-score': 'team',
      'succession/critical-role': 'critical-role',
      'succession/suggested-successors': 'critical-role',
      'succession/simulate-exit': 'critical-role',
      'evaluation360/cycle-progress': 'eval-cycle-staff',
      'evaluation360/my-report': 'eval-cycle-self',
    };
    let byIdCount = 0;
    for (const [surfaceKey, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (!ep.idScopeKey) continue;
        byIdCount++;
        const k = `${surfaceKey}/${ep.name}`;
        expect(expected[k], `unexpected by-id endpoint ${k}`).toBe(ep.idScopeKey);
        // the sentinel MUST appear in the path so the harness can substitute a concrete id.
        expect(ep.csharpPath, k).toContain('{id}');
        // ...and in exactly one input value, so the tRPC side resolves the same id.
        expect(JSON.stringify(ep.input), k).toContain('{id}');
      }
    }
    // 2 → 3 on 2026-08-11 (#195): + organization/detail, the first by-id endpoint whose RLS mode is
    // neither A nor B. 3 → 11 on 2026-08-17 (#195 residual): + the eight Mode-A probes of the four
    // re-registered surfaces (team-intel 3, succession 3, evaluation360 2). Pinned so a by-id
    // endpoint cannot appear without a line in `expected` above.
    expect(byIdCount).toBe(11);
  });

  // Kept surface-agnostic (rather than nine-box-specific) so it keeps applying as surfaces come and
  // go. NOTE: for a few hours on 2026-08-05 the nine-box surface was deleted and this loop iterated
  // ZERO times while still reading as a live guard — an assertion that cannot run is not a guard.
  // The count pin at the bottom is what makes that visible.
  it('every globalScope endpoint is a pure kernel — no by-id endpoint may claim org-independence', () => {
    let seen = 0;
    for (const [key, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (!ep.globalScope) continue;
        seen++;
        // globalScope INVERTS the RLS Mode-B heuristic, so it must never be set on an endpoint that
        // reads per-org rows by id — that would silently disable the leak check for it.
        expect(ep.idScopeKey, `${key}/${ep.name} is globalScope AND by-id`).toBeUndefined();
      }
    }
    // Documented state, 25 endpoints across 6 surfaces (this sentence read "9 across 4" for two
    // slices, then "21 across 6" for three more, while the arithmetic below it was edited — the
    // enumeration and count are the record; this line just has to agree with them. The four
    // surfaces re-registered C#-only on 2026-08-17 carry NO globalScope endpoint: every one is an
    // org-scoped staff read, Mode A or Mode B, so this count did not move). The loop above is the
    // invariant; this pins the
    // count so a NEW globalScope endpoint has to be looked at deliberately — and so that the loop
    // going empty (which would make the invariant unenforced while still reading as enforced) fails
    // here.
    //
    //   nine-box simulate + quadrant-plan — PURE KERNELS. Org-independent computation; the original
    //     and still the paradigm case for this flag.
    //   organization kpis + list — PLATFORM-OWNER CROSS-ORG READS (#195, added 2026-08-10). A
    //     different justification for the same flag, and worth stating so it is not read as
    //     precedent for the kernel case: these DO read org data, but the surface is
    //     platformProcedure/PlatformOwnerGate over the unscoped `db`, so there is no per-caller
    //     tenant boundary and Mode B's identical-payload heuristic would fire on the correct
    //     behaviour. `list` enumerates every tenant by definition. RBAC (org_admin 403 on both) is
    //     what proves the boundary here, not RLS.
    //   audit-log logs + export and access-review report + export + attestations — SAME
    //     platform-owner justification as organization (2026-08-11, re-registered C#-only). Both
    //     surfaces carried `globalScope: true` before they were deleted on 2026-07-31, so this is
    //     the pre-existing disposition restored, not a new claim of org-independence. access-review's
    //     three routes pin a FIXED non-existent org id in the query string rather than a seeded id —
    //     a literal, not the `{id}` sentinel — so the by-id invariant above is not being sidestepped.
    //
    //   invitation kpis + list + export — SAME platform-owner justification again (2026-08-12, Phase-5
    //     slice 22 / #75). All three are PlatformOwnerGate over the unscoped read context with no
    //     organizationId predicate anywhere; `kpis` is four unfiltered cross-org COUNTs, `list`
    //     enumerates every tenant's invitations, and `export` is the same read with no cap at all.
    //     org_admin 403 on all three is again what proves the boundary.
    //
    //   dashboard plan-distribution + user-growth + recent-activity — SAME platform-owner justification
    //     (2026-08-14, Phase-5 slice 23 / #81 PR 1). All three read cross-org aggregates over the
    //     unscoped dashboard context (every tenant's subscriptions, users and orgs) with no
    //     organizationId predicate; org_admin 403 is the boundary proof.
    //   dashboard attention-items + mrr-trend + mrr-forecast + customer-health + upsell-opportunities
    //     + search — the SAME surface, six more endpoints (2026-08-14, #81 PR 2), same gate, same
    //     unscoped context, same org_admin 403. `search` is the only one taking an input, and it is
    //     still org-independent: the term is matched across every tenant's organizations and users.
    //   dashboard kpis + revenue-by-customer + churn-risk — the SAME surface again, three more
    //     (2026-08-15, #81 PR 3), same gate and same unscoped context. These three are ALSO the
    //     surface's only C#-only entries (no `tsProcedure`, see caveat 8), and the two properties are
    //     independent: `globalScope` describes the TENANT boundary and is why RLS is N/A here, while
    //     the missing tsProcedure describes the PAYLOAD comparison and is why parity says [WEAK].
    //     Losing the second does not weaken the first — org_admin 403 is still asserted against the
    //     live C# route, which on a principal-type gate is the entire authorization boundary.
    //
    // None of these is by-id, so the invariant above still bites for them unchanged. (This line read
    // "None of the seven" until 2026-08-11; the count was never re-derived when access-review's three
    // routes were re-added. A superlative is a quantifier — count the set.)
    //
    // `getOrganization` is registered (#195) under `noTenantBoundaryForCaller`, which is a DIFFERENT
    // flag: it does not appear in this loop, it does not move this count, and this invariant is
    // untouched. Setting `globalScope` on it instead would push the count up AND trip the by-id
    // assertion above — which is the proof that the guard was worked with rather than weakened.
    //
    // The count sits NEXT TO its enumeration on purpose: 2 (ninebox) + 2 (organization) + 2 (audit-log)
    // + 3 (access-review) + 3 (invitation) + 13 (dashboard: 3 from PR 1, 6 from PR 2, 3 from PR 3,
    // plus ai-cost-anomalies) = 25. Every past drift here was a number written in prose while the list
    // lived elsewhere.
    expect(seen).toBe(2 + 2 + 2 + 3 + 3 + 13);
    expect(seen).toBe(25);
  });

  // ── #195 AC1: the monitoring read surface (2026-08-10) ───────────────────────────────────────
  it('monitoring registers all 6 deployed routes', () => {
    const s = SURFACES['monitoring'];
    expect(s.flag).toBe('Platform__MonitoringReadEnabled');
    // Counted from MonitoringReadEndpoints.cs, not taken from #195's text. If a 7th route ships, this
    // is where the omission surfaces.
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'executive-kpis',
      'module-health',
      'alerts',
      'action-plan-alerts',
      'cross-module-trend',
      'alert-rules',
    ]);
    // probeRole must be a role with a REAL org-wide grant, not super_admin — super_admin bypasses the
    // permission kernel, so probing with it would never exercise a grant.
    expect(s.probeRole).toBe('hr_admin');
    expect(s.roles).toContain(s.probeRole);
  });

  it('monitoring keeps a DENIED role, or its RBAC check proves nothing', () => {
    // All three normally-granted roles expect 200 here (MonitoringStaffGate deliberately does not
    // force the org gate, so hrbp@unit is 200 too). Without org_admin — which is absent from MATRIX
    // and holds no grants — every RBAC assertion on this surface would be "200 means allowed", with
    // nothing proving the permission check can say no.
    const s = SURFACES['monitoring'];
    for (const ep of s.endpoints) {
      const denied = Object.entries(ep.expectedByRole).filter(([, v]) => v === 403);
      expect(
        denied.map(([r]) => r),
        `${ep.name} has no denied role`,
      ).toEqual(['org_admin']);
    }
  });

  it('monitoring runs REAL RLS — nothing globalScope, nothing by-id', () => {
    // These are org-scoped aggregates, so Mode B is the meaningful check. globalScope or idScopeKey
    // here would silently downgrade it to N/A or to an IDOR probe that does not apply.
    for (const ep of SURFACES['monitoring'].endpoints) {
      expect(ep.globalScope, ep.name).toBeUndefined();
      expect(ep.idScopeKey, ep.name).toBeUndefined();
    }
  });

  // ── #195: the platform-organizations read surface (2026-08-10) ───────────────────────────────
  it('organization is registered with its flag + ALL 3 deployed reads', () => {
    const s = SURFACES['organization'];
    expect(s.flag).toBe('Platform__PlatformOrganizationsReadEnabled');
    expect(s.roles).toEqual(['platform_owner', 'org_admin']);
    // CORRECTED 2026-08-11: this asserted 'org_admin' from #203, pinning a defect rather than a
    // decision — org_admin is 403 on both endpoints, so the parity probe could never succeed and the
    // TS leg would throw (trpc.ts:11). The generalised probeRole-expects-200 invariant above is what
    // makes this class of mistake unshippable; this line now just records the corrected value.
    expect(s.probeRole).toBe('platform_owner');

    // 2026-08-11 (#195): 'detail' added. PlatformOrganizationsReadEndpoints.cs maps exactly three
    // GETs (:43 kpis, :65 list, :113 by-id), so this is now the whole deployed read surface.
    expect(s.endpoints.map((e) => e.name)).toEqual(['kpis', 'list', 'detail']);

    for (const ep of s.endpoints) {
      // Both flags still dark, TS still the live path — so every endpoint MUST keep a tsProcedure and
      // produce a real byte diff. A [WEAK] here would mean the pre-flip readiness check proves nothing.
      // (`detail` carries a KNOWN, source-derived divergence — C# `counts` vs Prisma `_count`. It
      // keeps its tsProcedure anyway: dropping it to dodge a predicted red is how a gate is made
      // unable to fail. See the endpoint comment in surfaces.ts.)
      expect(ep.tsProcedure, ep.name).toBeTruthy();
      // RBAC is the boundary proof on a platform-owner surface, since RLS is N/A on all three.
      expect(ep.expectedByRole, ep.name).toEqual({ platform_owner: 200, org_admin: 403 });
    }

    // The RLS N/A is reached by TWO DIFFERENT flags, and conflating them is the mistake this
    // asserts against. kpis/list are genuinely org-independent payloads; detail's payload is
    // org-SPECIFIC and only its CALLER is boundary-free.
    const byName = (n: string) => s.endpoints.find((e) => e.name === n)!;
    for (const n of ['kpis', 'list']) {
      expect(byName(n).globalScope, n).toBe(true);
      expect(byName(n).noTenantBoundaryForCaller, n).toBeUndefined();
      expect(byName(n).idScopeKey, n).toBeUndefined();
    }
    expect(byName('detail').globalScope, 'detail must NOT claim org-independence').toBeUndefined();
    expect(byName('detail').noTenantBoundaryForCaller).toBe(true);
  });

  it('invitation is registered with its flag and all THREE deployed reads, each keeping a tsProcedure', () => {
    // Every other surface here has a per-surface pin; `invitation` shipped in slice 22 with only the
    // key-set entry and the globalScope count, which a coverage review flagged. Without this block,
    // dropping a `tsProcedure` silently degrades all three endpoints to [WEAK] — the pre-flip readiness
    // check then proves nothing — and the suite stays green. Same rationale as the organization pin above.
    const s = SURFACES.invitation;

    // The flag string is what `checks/preflight.ts` and `cli.ts` PRINT to say which env var to flip.
    // A typo here is otherwise undetectable until someone flips the wrong one in prod.
    expect(s.flag).toBe('Platform__PlatformInvitationsReadEnabled');
    expect(s.probeRole).toBe('platform_owner');
    expect(s.endpoints.map((e) => e.name)).toEqual(['kpis', 'list', 'export']);

    for (const ep of s.endpoints) {
      // The TS side of this surface is still LIVE (unlike audit-log/access-review, whose TS was deleted),
      // so a real payload diff is available and must not be given up.
      expect(ep.tsProcedure, ep.name).toBeTruthy();
      expect(ep.expectedByRole, ep.name).toEqual({ platform_owner: 200, org_admin: 403 });
      // Platform-owner-only and deliberately cross-org: no endpoint here is by-id, so none may carry
      // idScopeKey, and the RLS N/A is reached via globalScope rather than the by-id marker.
      expect(ep.idScopeKey, ep.name).toBeUndefined();
      expect(ep.noTenantBoundaryForCaller, ep.name).toBeUndefined();
      expect(ep.globalScope, ep.name).toBe(true);
    }
  });

  it('dashboard is registered with its flag and all THIRTEEN deployed reads', () => {
    const s = SURFACES.dashboard;

    // The flag string is what `checks/preflight.ts` and `cli.ts` PRINT to say which env var to flip.
    expect(s.flag).toBe('Platform__PlatformDashboardReadEnabled');
    expect(s.probeRole).toBe('platform_owner');
    // Counted from PlatformDashboardReadEndpoints.cs + PlatformDashboardFxReadEndpoints.cs +
    // PlatformDashboardAiReadEndpoints.cs, not from the issue text. ONE flag covers all thirteen — the
    // complete cluster — so an unregistered fourteenth route would go live at the same flip with
    // nothing comparing it.
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'plan-distribution',
      'user-growth',
      'recent-activity',
      'attention-items',
      'mrr-trend',
      'mrr-forecast',
      'customer-health',
      'upsell-opportunities',
      'search',
      'kpis',
      'revenue-by-customer',
      'churn-risk',
      'ai-cost-anomalies',
    ]);

    for (const ep of s.endpoints) {
      expect(ep.expectedByRole, ep.name).toEqual({ platform_owner: 200, org_admin: 403 });
      // Platform-owner-only and deliberately cross-org: nothing here is by-id, so the RLS N/A is
      // reached via globalScope rather than idScopeKey or the by-id caller marker.
      expect(ep.idScopeKey, ep.name).toBeUndefined();
      expect(ep.noTenantBoundaryForCaller, ep.name).toBeUndefined();
      expect(ep.globalScope, ep.name).toBe(true);
      // NO normalize on ANY of the thirteen, asserted because each absence is a decision recorded in
      // surfaces.ts — most sharply on customer-health and upsell-opportunities, where a
      // `sortArraysBy: 'orgId'` rule would cure a real tie-flake by deleting the only thing those two
      // endpoints compute that a diff can see.
      expect(ep.normalize, ep.name).toBeUndefined();
    }
  });

  it('dashboard: exactly the three FX reads are C#-only, and every other endpoint keeps its tsProcedure', () => {
    // The SPLIT is the assertion, in both directions. Ten endpoints have a LIVE TS side (the flag is
    // dark), so dropping a `tsProcedure` there would silently degrade a real payload diff to [WEAK] —
    // the invitation pin's rationale. The other three have no comparable TS side at all: they call
    // sumMoney, and the two stacks resolve rates from different providers (live Frankfurter vs the
    // DB-pinned fx_rates row), so a `tsProcedure` would produce a PERMANENT FAIL that is not a port
    // defect. Both mistakes are silent without this test, and they are opposite mistakes.
    const s = SURFACES.dashboard;
    const fxOnly = ['kpis', 'revenue-by-customer', 'churn-risk'];

    for (const ep of s.endpoints) {
      if (fxOnly.includes(ep.name)) {
        expect(ep.tsProcedure, `${ep.name} must stay C#-only — see surfaces.ts caveat 8`).toBeUndefined();
      } else {
        expect(ep.tsProcedure, ep.name).toBeTruthy();
      }
    }

    // And the count, so a FOURTH endpoint quietly joining the C#-only set has to be argued for.
    expect(s.endpoints.filter((e) => !e.tsProcedure).map((e) => e.name)).toEqual(fxOnly);
  });

  it('dashboard: only `search` carries an input, and its csharpPath query string agrees with it', () => {
    // The two halves are sent to DIFFERENT stacks — `input` to the tRPC procedure, `csharpPath` to the
    // C# route — so a mismatch would have them answering different questions and the diff would be
    // meaningless rather than red. Nothing else in the registry cross-checks the two.
    const s = SURFACES.dashboard;

    for (const ep of s.endpoints) {
      if (ep.name === 'search') continue;
      expect(ep.input, ep.name).toEqual({});
      expect(ep.csharpPath, ep.name).not.toContain('?');
    }

    const search = s.endpoints.find((e) => e.name === 'search')!;
    const term = (search.input as { query: string }).query;
    expect(term).toBeTruthy();
    expect(search.csharpPath).toBe(`/platform/dashboard/search?query=${term}`);
  });

  it('getOrganization is registered under the by-id platform-owner marker, NOT globalScope', () => {
    // Replaces the pin on a DELIBERATE omission (which read: "stays UNregistered until a by-id
    // platform-owner endpoint can be expressed"). It can now be expressed — by a NEW, explicitly-named
    // field, not by overloading `globalScope`. The globalScope+idScopeKey guard above was left exactly
    // as it was; this endpoint satisfies it rather than sidestepping it.
    const s = SURFACES['organization'];
    const names = s.endpoints.map((e) => e.name);
    expect(names).toContain('detail');
    const detail = s.endpoints.find((e) => e.name === 'detail')!;
    expect(detail.idScopeKey, 'detail must bind a REAL seeded org id — the endpoint 404s on an unknown org').toBe(
      'organization',
    );
    expect(detail.noTenantBoundaryForCaller).toBe(true);
    expect(detail.globalScope, 'detail is NOT a pure kernel — its payload is org-specific').toBeUndefined();
    // The deployed route is `/platform/organizations/{id:guid}`; the registry writes the harness's
    // canonical sentinel, because ids.ts substitutes a concrete id rather than calling by template.
    expect(detail.csharpPath).toBe('/platform/organizations/{id}');
  });

  it('noTenantBoundaryForCaller is by-id only, never globalScope, and denies EVERY non-platform-owner role', () => {
    let seen = 0;
    for (const [key, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (!ep.noTenantBoundaryForCaller) continue;
        seen++;
        // (i) Only meaningful on a by-id endpoint — it suppresses RLS Mode A and nothing else. A
        //     Tier-1 endpoint claiming it is a category error, and would read as a general Mode-B
        //     suppressor, which is what globalScope is for.
        expect(ep.idScopeKey, `${key}/${ep.name}: marker set without idScopeKey`).toBeDefined();
        // (ii) Never both. They assert different things (payload vs caller); combining them is the
        //      overload the globalScope guard above exists to prevent.
        expect(ep.globalScope, `${key}/${ep.name}: marker AND globalScope`).toBeUndefined();
        // (iii) RBAC is the ENTIRE boundary proof once RLS is N/A, so EVERY non-platform-owner role
        //       must be denied — not merely "some role somewhere is denied".
        //
        //       An earlier version asserted `Object.values(...).toContain(403)`, which is the weaker
        //       claim and survives the case that matters: a later slice makes an org's own admin able
        //       to read its own org detail (`{platform_owner:200, org_admin:200, hrbp:403}`). A real
        //       cross-tenant boundary would then exist again — org-A's admin reaching org-B's id —
        //       while this marker keeps RLS Mode A suppressed, and the RBAC leg could not see it
        //       either, since it only ever probes org A's OWN id. (On today's registry that specific
        //       edit is caught by the organization-surface pin below, which pins the whole
        //       expectedByRole map — but that pin is surface-specific and this invariant is the one a
        //       FUTURE endpoint inherits, so it must carry the constraint itself.)
        for (const [role, expectation] of Object.entries(ep.expectedByRole)) {
          if (role === 'platform_owner') continue;
          expect(
            expectation,
            `${key}/${ep.name}: role "${role}" is ${expectation}, but every non-platform-owner role must be 403 — ` +
              'a role this endpoint answers 200 to is a tenant boundary that RLS Mode A is being told to skip',
          ).toBe(403);
        }
        // ...and at least one such role must EXIST, or the loop above is vacuous.
        expect(
          Object.keys(ep.expectedByRole).filter((r) => r !== 'platform_owner'),
          `${key}/${ep.name} declares no non-platform-owner role at all`,
        ).not.toEqual([]);
        // (iv) Only a platform-owner-gated surface qualifies — a constraint no org-scoped surface can
        //      satisfy by accident. This is a PROXY, and worth naming as one: it reads a registry
        //      field, not the deployed gate. Nothing in this repo verifies the marker's actual stated
        //      precondition (served by a platform-owner gate over the UNSCOPED client) — and two
        //      other registered surfaces (audit-log, access-review) already satisfy the proxy, so a
        //      future by-id read added to either could carry the marker while in fact being served
        //      through a tenant-scoped repository. THE COUNT PIN BELOW IS THE REAL BACKSTOP for that
        //      case: it forces the edit to be deliberate and reviewed, which (iv) alone does not.
        expect(surface.probeRole, `${key}: marker on a non-platform-owner surface`).toBe('platform_owner');
      }
    }
    // Count pin with a reason PER ENDPOINT, so the loop going empty fails HERE instead of reading as
    // an enforced invariant (the 2026-08-05 nine-box lesson recorded above). It is ALSO the only
    // forcing function on the marker's unverifiable precondition — see (iv). Adding a second marked
    // endpoint must be a deliberate edit here, with its own line, naming the gate it is served by.
    //   organization/detail — GET /platform/organizations/{id}. platformProcedure / PlatformOwnerGate
    //     over the unscoped db; a platform owner reading org B is the FEATURE, and it 404s on an
    //     unknown org (organizations.ts:145), so the access-review fixed-non-existent-id trick cannot
    //     apply and a real seeded id is required.
    expect(seen).toBe(1);
  });

  // ── The two platform-owner READ surfaces re-registered C#-only on 2026-08-11 ──────────────────
  // Both were REMOVED on 2026-07-31 (audit-log in 2950a06c, access-review in 18282f96) on the
  // reasoning "the TS procedures are deleted, so there is nothing left to diff". `tsProcedure`
  // became optional on 2026-08-06 (efb7553f) — SIX DAYS LATER — which is what makes that reasoning
  // obsolete rather than merely debatable. These tests pin the RESTORATION the same way the nine-box
  // and dei tests pin theirs: a future cleanup that deletes either surface "because the TS is gone"
  // fails here, with the reason attached.
  //
  // What the restoration buys, stated narrowly on purpose: the RBAC deny assertion and the
  // C#-returns-200 liveness check against a flag that is LIVE in prod. It does NOT buy a cross-tenant
  // probe — every endpoint on both surfaces is globalScope, and was before deletion too, so the RLS
  // check is a documented N/A now exactly as it was then.
  it.each([
    ['audit-log', 'Platform__AuditLogReadEnabled', ['logs', 'export']],
    ['access-review', 'Platform__AccessReviewReadEnabled', ['report', 'export', 'attestations']],
  ])('%s stays registered as a C#-only platform-owner surface', (key, flag, endpointNames) => {
    const s = SURFACES[key];
    expect(
      s,
      `the ${key} read surface was deleted — that retires its RBAC deny assertion on a LIVE flag`,
    ).toBeDefined();
    expect(s.flag).toBe(flag);
    expect(s.roles).toEqual(['platform_owner', 'org_admin']);
    // MUST be the allowed role: checks/parity.ts:26-33 fails a C#-only endpoint on any non-200, and
    // cli.ts's mintTokens skips the org-B token requirement only for platform_owner.
    expect(s.probeRole).toBe('platform_owner');
    // Pinned by name and counted from the endpoints file, not auto-discovered: dropping a route
    // must turn this red.
    expect(s.endpoints.map((e) => e.name)).toEqual(endpointNames);

    for (const ep of s.endpoints) {
      // The TS routers are deleted. A re-added tsProcedure would mean a second live implementation.
      expect(ep.tsProcedure, `${key}/${ep.name} must be C#-only — the TS router is deleted`).toBeUndefined();
      // RBAC is the ENTIRE boundary proof on a principal-type gate, so the deny must be present.
      expect(ep.expectedByRole, `${key}/${ep.name}`).toEqual({ platform_owner: 200, org_admin: 403 });
      expect(ep.globalScope, `${key}/${ep.name}`).toBe(true);
      expect(ep.idScopeKey, `${key}/${ep.name}`).toBeUndefined();
    }
  });

  it('access-review pins a FIXED non-existent org id — not the {id} sentinel, and not a real org', () => {
    // The three routes take a REQUIRED organizationId. The all-zeros UUID is deliberate: neither
    // expectation depends on the org existing. The 403 comes from PlatformOwnerGate before any org
    // lookup; the 200 is an EMPTY report, because AccessReviewService.BuildReportAsync has no
    // org-exists precondition (only AttestAsync does, AccessReviewService.cs:35). Using a real
    // seeded org id instead would turn these into by-id endpoints and collide with the globalScope
    // invariant above — which is why this surface must NOT be rewritten to use a seeded id without
    // moving to `noTenantBoundaryForCaller`, the marker `getOrganization` needed. (This sentence
    // used to end "...which is precisely why getOrganization is still unregistered". It IS
    // registered, as of 2026-08-11 (#195) — under that marker, not by weakening this invariant.)
    const s = SURFACES['access-review'];
    // Paths pinned EXACTLY, not by substring. An earlier revision asserted only
    // `.toContain('organizationId=...')`, which left the route itself unpinned — a mutation to
    // `/access-review/EXPORT-TYPO?organizationId=...` kept the whole file green. Nothing else in this
    // repo compares a registry csharpPath to a real deployed route, so this assertion is the only
    // thing standing between a C# route rename and a verify run that 404s in Federico's hands.
    expect(s.endpoints.map((e) => e.csharpPath)).toEqual([
      '/access-review?organizationId=00000000-0000-0000-0000-000000000000',
      '/access-review/export?organizationId=00000000-0000-0000-0000-000000000000',
      '/access-review/attestations?organizationId=00000000-0000-0000-0000-000000000000',
    ]);
    for (const ep of s.endpoints) {
      expect(ep.csharpPath, `${ep.name} must not use the by-id sentinel`).not.toContain('{id}');
      expect(ep.input, ep.name).toEqual({ organizationId: '00000000-0000-0000-0000-000000000000' });
    }
  });

  it('audit-log registers BOTH deployed routes, including the export the original entry missed', () => {
    // Counted from AuditReadEndpoints.cs (MapGet at :32 and :63), not carried over from the deleted
    // entry, which registered only `logs`. /audit/logs/export sits behind the same live flag and the
    // same gate and had never had an RBAC assertion at all.
    const paths = SURFACES['audit-log'].endpoints.map((e) => e.csharpPath);
    expect(paths).toEqual(['/audit/logs', '/audit/logs/export']);
  });

  // ── Coverage-audit additions (2026-07-27) ────────────────────────────────────────────────────
  it('engagement is registered with its flag + the 2 reads that still have a TS side', () => {
    const s = SURFACES['engagement'];
    expect(s.flag).toBe('Platform__EngagementReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    // UPDATE 2026-07-31: shrunk from 9 to 2 — the other 7 TS procedures were deleted (C#-only now,
    // NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod).
    expect(s.endpoints.map((e) => e.name).sort()).toEqual(['rotation-risk', 'surveys']);
    // neither surviving engagement read is by-id.
    for (const e of s.endpoints) expect(e.idScopeKey).toBeUndefined();
  });

  it('engagement: listSurveys (grant-only) passes hrbp; getRotationRisk (org-rollup) denies hrbp', () => {
    const s = SURFACES['engagement'];
    expect(s.endpoints.find((e) => e.name === 'surveys')?.expectedByRole['hrbp']).toBe(200);
    expect(s.endpoints.find((e) => e.name === 'rotation-risk')?.expectedByRole['hrbp']).toBe(403);
    // super_admin/hr_admin allow everywhere.
    for (const e of s.endpoints) {
      expect(e.expectedByRole['super_admin'], e.name).toBe(200);
      expect(e.expectedByRole['hr_admin'], e.name).toBe(200);
    }
  });

  // dei's READ surface was registered 2026-07-27 and shrunk 10 → 2 on 2026-07-31. On 2026-08-06
  // (#60) its last two TS procedures (dei.getEthnicityDistribution / dei.getDisabilityDistribution)
  // were deleted from packages/api/src/routers/dei.ts. This is the INVERSION of the previous
  // 'dei is registered with its flag + the 2 zero-FE-consumer reads' test — the endpoint set and
  // RBAC expectations are still pinned BY NAME (a deletion must not be a green change), but the
  // TS-side assertion flips from "registered" to "must be absent".
  //
  // The surface is deliberately NOT removed: per EndpointDef.tsProcedure's contract, omitting the
  // field keeps the endpoint C#-only so parity reports [WEAK] rather than silently passing, while
  // the RBAC (hrbp 403) and RLS cross-org checks keep running against the live C# demographic
  // reads. This test is what stops a future cleanup from deleting the surface and taking that
  // coverage with it.
  it('dei stays registered as C#-only after the #60 TS deletion — endpoints pinned, tsProcedure gone', () => {
    const s = SURFACES['dei'];
    expect(s, 'the dei surface must NOT be deleted — removing it retires the C# RBAC + RLS checks').toBeDefined();
    expect(s.flag).toBe('Platform__DeiReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    // Pinned by name, not auto-discovered: dropping an endpoint must turn this red.
    expect(s.endpoints.map((e) => e.name).sort()).toEqual(['disability-distribution', 'ethnicity-distribution']);
    // pay-equity is deliberately excluded (separate Platform__FxReadsEnabled flag).
    expect(s.endpoints.find((e) => e.name === 'pay-equity')).toBeUndefined();
    for (const e of s.endpoints) {
      expect(e.expectedByRole, e.name).toEqual({ super_admin: 200, hr_admin: 200, hrbp: 403 });
      // #60: no TS side left to diff against — a re-added tsProcedure would mean a second live
      // implementation of a k-anonymity-sensitive aggregate.
      expect(e.tsProcedure, `${e.name} must have no tsProcedure after the #60 TS deletion`).toBeUndefined();
    }
  });

  // No OTHER surface may smuggle a dei TS read back in under a different key.
  it('no surface anywhere registers a dei tsProcedure (#60)', () => {
    for (const [key, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        expect(ep.tsProcedure?.startsWith('dei.') ?? false, `${key}/${ep.name} re-registers a TS dei read`).toBe(false);
      }
    }
  });

  // billing-invoices' SURFACES entry was removed 2026-07-31 (TS listInvoices/getInvoice deleted,
  // NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP confirmed live) — no TS side left to diff against, so
  // there is nothing left for this suite to assert about it.
  it('billing-invoices is no longer registered (TS side deleted)', () => {
    expect(SURFACES['billing-invoices']).toBeUndefined();
  });

  // ── The four talent read surfaces re-registered C#-only on 2026-08-17 (#195 residual) ────────
  // All four were deleted in the 2026-07-29..08-03 TS-deletion passes (succession last, #58) and
  // restored on the audit-log/access-review rationale: only checks/parity.ts reads `tsProcedure`,
  // so the deletions had retired RBAC deny assertions and RLS probes, not a stale comparison.
  // These pins are the same shape as the audit-log/access-review restoration pins above: a future
  // cleanup that deletes any of them "because the TS is gone" fails here with the reason attached.
  // Role expectations were copied from the deleted registrations (git 0a368681) and re-checked
  // against the C# gates; the fixtures they lean on are seed.ts's
  // seed{TeamIntel,Reporting,Succession,Evaluation360}{Grants,Data} + seedOrgBTier2Mirrors, all
  // verified wired into seed().

  it('team-intel is re-registered C#-only: 5 of 7 deployed routes, hrbp denied everywhere', () => {
    const s = SURFACES['team-intel'];
    expect(s, 'deleting team-intel retires 3 Mode-A IDOR probes + the RBAC denies').toBeDefined();
    expect(s.flag).toBe('Platform__TeamIntelReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'dashboard-kpis',
      'compare',
      'profile',
      'members',
      'balance-score',
    ]);
    // The two deployed routes NOT here — balance-alerts + recommended-hires — are honest 501
    // stubs: no role answers 200, which the harness contract cannot express (expectedByRole is
    // 200|403; parity fails a C#-only endpoint on any non-200; the probeRole invariant above
    // demands a 200). They are allowlisted with that reason in
    // tests/governance/parity-registry-covers-deployed-routes.test.ts — registering them here
    // would manufacture a permanent false-RED. When they ship real bodies, they join this list.
    for (const name of ['balance-alerts', 'recommended-hires']) {
      expect(
        s.endpoints.find((e) => e.name === name),
        `${name} is a 501 stub — must NOT be registered`,
      ).toBeUndefined();
    }
    for (const ep of s.endpoints) {
      expect(ep.tsProcedure, `${ep.name} must be C#-only — the teamIntel router is deleted`).toBeUndefined();
      expect(ep.expectedByRole, ep.name).toEqual({ super_admin: 200, hr_admin: 200, hrbp: 403 });
      expect(
        ep.normalize,
        `${ep.name}: no payload diff runs, a normalize rule would be unargued inheritance`,
      ).toBeUndefined();
      expect(ep.globalScope, ep.name).toBeUndefined();
    }
    // The by-id trio threads the NEW 'team' resource pair; compare/dashboard-kpis are Mode B.
    for (const name of ['profile', 'members', 'balance-score']) {
      expect(s.endpoints.find((e) => e.name === name)!.idScopeKey, name).toBe('team');
    }
    // compare's two teamIds are FIXED NON-EXISTENT uuids (its Mode B is vacuous by design — the
    // surface header carries the argument); path query and input must name the same pair.
    const compare = s.endpoints.find((e) => e.name === 'compare')!;
    const ids = (compare.input as { teamIds: string[] }).teamIds;
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(compare.csharpPath).toContain(`teamIds=${id}`);
  });

  it('reporting is re-registered C#-only: all 6 deployed routes, hrbp 403 via the real org-gate', () => {
    const s = SURFACES['reporting'];
    expect(s, 'deleting reporting retires 6 RBAC deny assertions on deployed routes').toBeDefined();
    expect(s.flag).toBe('Platform__ReportingReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'kpis',
      'funnel',
      'source-breakdown',
      'trend',
      'lost-by-delay',
      'recruiter-sla',
    ]);
    for (const ep of s.endpoints) {
      expect(ep.tsProcedure, `${ep.name} must be C#-only — the recruitmentAnalytics router is deleted`).toBeUndefined();
      // hrbp holds vacancy:read@UNIT (seedReportingGrants), so its 403 exercises the REAL
      // requireOrgScope path — grant held, scope too narrow — on every endpoint.
      expect(ep.expectedByRole, ep.name).toEqual({ super_admin: 200, hr_admin: 200, hrbp: 403 });
      expect(ep.normalize, ep.name).toBeUndefined();
      expect(ep.idScopeKey, ep.name).toBeUndefined();
      expect(ep.globalScope, ep.name).toBeUndefined();
    }
    // The three windowed reads bake period=30D into the path AND mirror it in input — callCsharp
    // uses csharpPath verbatim, so a drift between the two would probe a different window than the
    // one the registry claims. (The old second kpis probe at 90D is deliberately NOT restored: it
    // normalises to the same VERB+path key as kpis, which the route-coverage guard forbids.)
    for (const name of ['kpis', 'source-breakdown', 'lost-by-delay']) {
      const ep = s.endpoints.find((e) => e.name === name)!;
      expect(ep.csharpPath, name).toContain('?period=30D');
      expect(ep.input, name).toEqual({ period: '30D' });
    }
  });

  it('succession is re-registered C#-only: all 9 deployed reads, org_admin as the uniform grant-level deny', () => {
    const s = SURFACES['succession'];
    expect(s, 'deleting succession retires 3 Mode-A IDOR probes + 9 RBAC denies').toBeDefined();
    expect(s.flag).toBe('Platform__SuccessionReadEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.roles).toEqual(['super_admin', 'hr_admin', 'hrbp', 'org_admin']);
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'critical-roles',
      'flight-risk',
      'competency-coverage',
      'roles-without-successor',
      'comp-gap-alerts',
      'dashboard-kpis',
      'critical-role',
      'suggested-successors',
      'simulate-exit',
    ]);
    for (const ep of s.endpoints) {
      expect(ep.tsProcedure, `${ep.name} must be C#-only — the succession router is deleted (#58)`).toBeUndefined();
      expect(ep.normalize, ep.name).toBeUndefined();
      expect(ep.globalScope, ep.name).toBeUndefined();
      // org_admin holds NO succession grant (absent from MATRIX, no seeded role_permissions), so
      // PermissionService itself refuses it — a grant-level 403 on every endpoint, decided BEFORE
      // the by-id probe. Without it the list + by-id trio would have no denied role at all.
      expect(ep.expectedByRole['org_admin'], ep.name).toBe(403);
      expect(ep.expectedByRole['super_admin'], ep.name).toBe(200);
      expect(ep.expectedByRole['hr_admin'], ep.name).toBe(200);
    }
    // hrbp's three dispositions, pinned individually (the surface header carries the reasoning):
    // 200-scoped-empty on the list, 403 via requireOrgScope on the five rollups, OMITTED on the
    // by-id trio (the ScopedProbe answers 404, which 200|403 cannot express).
    const hrbpOf = (n: string) => s.endpoints.find((e) => e.name === n)!.expectedByRole['hrbp'];
    expect(hrbpOf('critical-roles')).toBe(200);
    for (const n of [
      'flight-risk',
      'competency-coverage',
      'roles-without-successor',
      'comp-gap-alerts',
      'dashboard-kpis',
    ]) {
      expect(hrbpOf(n), n).toBe(403);
    }
    for (const n of ['critical-role', 'suggested-successors', 'simulate-exit']) {
      expect(hrbpOf(n), `${n}: hrbp must be OMITTED — its correct status is the probe's 404`).toBeUndefined();
      expect(s.endpoints.find((e) => e.name === n)!.idScopeKey, n).toBe('critical-role');
    }
  });

  it('evaluation360 is re-registered C#-only: 2 staff reads with an hrbp deny + 3 self-service reads', () => {
    const s = SURFACES['evaluation360'];
    expect(s, 'deleting evaluation360 retires 2 Mode-A IDOR probes + the staff-read denies').toBeDefined();
    expect(s.flag).toBe('Platform__Evaluation360ReadEnabled');
    // LOAD-BEARING, not stylistic: seedOrgBTier2Mirrors builds the org-B Mode-A positive controls
    // around b:super_admin (openB rater assignment, pubB published self-subject). A different
    // probe identity fails those controls for a fixture reason.
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'cycles',
      'cycle-progress',
      'my-rater-tasks',
      'my-report-cycles',
      'my-report',
    ]);
    for (const ep of s.endpoints) {
      expect(
        ep.tsProcedure,
        `${ep.name} must be C#-only — the evaluation360 read procedures are deleted`,
      ).toBeUndefined();
      expect(ep.normalize, ep.name).toBeUndefined();
      expect(ep.globalScope, ep.name).toBeUndefined();
    }
    // STAFF pattern (grant + org-gate): hrbp holds no evaluation360 grant → a real 403.
    for (const n of ['cycles', 'cycle-progress']) {
      expect(s.endpoints.find((e) => e.name === n)!.expectedByRole, n).toEqual({
        super_admin: 200,
        hr_admin: 200,
        hrbp: 403,
      });
    }
    // SELF-SERVICE pattern (identity only, no 403 path): all-200 by construction — these three sit
    // on the documented no-denial list above. my-report asserts ONLY super_admin: any non-subject
    // caller gets the deliberate not-yours/not-published 404, which 200|403 cannot express.
    for (const n of ['my-rater-tasks', 'my-report-cycles']) {
      expect(s.endpoints.find((e) => e.name === n)!.expectedByRole, n).toEqual({
        super_admin: 200,
        hr_admin: 200,
        hrbp: 200,
      });
    }
    const myReport = s.endpoints.find((e) => e.name === 'my-report')!;
    expect(myReport.expectedByRole).toEqual({ super_admin: 200 });
    expect(myReport.idScopeKey).toBe('eval-cycle-self');
    expect(s.endpoints.find((e) => e.name === 'cycle-progress')!.idScopeKey).toBe('eval-cycle-staff');
  });

  // nine-box's TS side was deleted 2026-08-05 (#57) — but unlike succession above, the SURFACE is
  // retained, C#-only. Only checks/parity.ts reads `tsProcedure`; checks/rls.ts and checks/rbac.ts
  // take `callCsharp` alone. So deleting the surface would not have retired a stale TS comparison,
  // it would have retired the RLS Mode-A cross-tenant IDOR probe on `axis-breakdown` and the RBAC
  // deny assertions. Those cover the 4 endpoints registered below, not all 11 deployed C# reads —
  // see the scope note in surfaces.ts. `axis-breakdown` has no cross-org C# integration test
  // (NineBoxReadTests.cs:240 covers getGrid, which is not registered here).
  //
  // This asserts the RETENTION, deliberately: the endpoints must stay registered AND must carry no
  // tsProcedure. A future cleanup that deletes the surface "because the TS is gone" fails here with
  // the reason attached.
  it('nine-box read stays registered as a C#-only surface (RLS/RBAC coverage survives TS deletion)', () => {
    const s = SURFACES['ninebox'];
    expect(s, 'nine-box read surface was deleted — that removes the cross-tenant IDOR probe').toBeDefined();
    expect(s!.endpoints.map((e) => e.name).sort()).toEqual([
      'axis-breakdown',
      'movement-history',
      'quadrant-plan',
      'simulate',
    ]);
    for (const ep of s!.endpoints) {
      expect(ep.tsProcedure, `${ep.name} must be C#-only — the TS router is deleted`).toBeUndefined();
    }
    // The IDOR probe specifically.
    const byId = s!.endpoints.find((e) => e.name === 'axis-breakdown')!;
    expect(byId.idScopeKey).toBe('employee');
    expect(byId.expectedByRole.hrbp).toBe(403);
  });

  // #211. `sortArraysBy` is applied by normalize.ts at EVERY array depth, not just the one the author
  // had in mind. On `organization` `list` the outermost array IS `organizations[]`, whose order is the
  // createdAt-desc / pagination behaviour this surface exists to compare — so adding `sortArraysBy`
  // here to silence a nested-array flake would silently retire that comparison and the surface would
  // stay green while proving strictly less.
  //
  // The nested pending-invoice array was the real flake risk, and it is fixed at the SOURCE instead:
  // both stacks now order it by id (organizations.ts `invoices` include; the ordinal-string OrderBy in
  // PlatformOrganizationsReadRepository.cs). This test exists so a future "make the flake go away"
  // edit has to argue with a failing assertion rather than land unnoticed.
  it('organization list does NOT use sortArraysBy (it would also sort organizations[] and retire the ordering check)', () => {
    const list = SURFACES['organization']!.endpoints.find((e) => e.name === 'list')!;
    expect(list.normalize?.sortArraysBy).toBeUndefined();
    // dropNullish is expected and unrelated — asserted so this test cannot be satisfied by deleting
    // `normalize` wholesale.
    expect(list.normalize?.dropNullish).toBe(true);
  });
});
