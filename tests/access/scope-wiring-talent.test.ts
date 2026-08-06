import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 4 — static tripwires for the TALENT modules:
// ninebox (9-box + calibration), succession (critical roles / successors),
// teamIntel (team-keyed analytics). These three carry leader@team grants in
// the matrix, so own/team/unit reads must filter rows.
//
// ── ninebox taxonomy ──────────────────────────────────────────────────
// UPDATE 2026-07-29: getGrid, getEmployeeDetail, createCalibration,
// listCalibrations, getCalibration, myCalibrations, getBenchStrength,
// getDashboardKpis had their TS side DELETED (7 reads + 3 writes wrapped
// live in prod) — the taxonomy below now covers only the 6 zero-FE-consumer
// procedures that remain, unrelated dead code out of scope for that deletion.
//   getAxisBreakdown / getMovementHistory → row-level reads of
//     NineBoxEvaluation → AND-compose the nineBoxEvaluation fragment (the
//     existing teamId/unitId/companyId input branches only INTERSECT).
//     getAxisBreakdown additionally subjects its target userId via
//     assertSubjectInScope (point-read).
//   simulate            → pure math on input scores (no DB read) → untouched.
//   submitCalibrationVote → THE membership rule (mirrors submitScorecard):
//     fetch session org-scoped, require the VOTER is a calibrationMember,
//     FORBIDDEN otherwise. voterId already comes from ctx.user.id (not input).
//   finalizeCalibration → session lifecycle write → requireOrgScope.
//   getQuadrantPlan     → static plan lookup (no DB read) → untouched.
//
// ── succession taxonomy — REMOVED 2026-08-03 (#58) ────────────────────
// packages/api/src/routers/succession.ts is DELETED. The 2026-07-29 pass removed 8 of 9
// reads + 2 of 5 writes; #58 removed the last 4 (getCriticalRole, addCriticalRole,
// removeSuccessor, updateSuccessorReadiness — all zero-FE-consumer). There is no TS
// source file left for a static tripwire to grep, so the three succession assertions that
// used to live below are gone rather than skipped.
//
// These tripwires were STATIC source greps. The equivalent guarantees are enforced against the C#
// owner as REAL HTTP integration tests, which for the LIVE code path is a stronger check than a
// regex over source (services/Tims.Platform/tests/Tims.IntegrationTests/Succession/):
//   assertScoped('successor') on remove/update  → RemoveSuccessor_Leader_OutOfScope_Is404,
//                                                 UpdateReadiness_Leader_OutOfScope_Is404
//   requireOrgScope on addCriticalRole          → AddCriticalRole_NarrowLeader_Is403_RequireOrgScope
//   assertScoped('criticalRole') by-id probe    → TeamScope_OutOfScopeRole_Is404_IdorProbe,
//                                                 TeamScope_OutOfScope_ByIdReads_Are404
//   nested successors carry the scope fragment  → TeamScope_ListCriticalRoles_DropsOutOfScopeRole
// The write surface also keeps its live parity/IDOR/RBAC check — scripts/parity/write-surfaces.ts's
// successionSurface hits the C# endpoints directly (no tsProcedure), so it is unaffected by this
// deletion. Only the READ parity surface went no-op (scripts/parity/surfaces.ts).
//
// HONEST LIMIT of the swap, so nobody over-reads it: these are not the same control. The C# tests
// guard the C# implementation. They would NOT catch a future TS succession router reintroduced
// without assertScoped/requireOrgScope — the tripwire that used to catch exactly that is gone, and
// no C# test can replace it.
//
// There is NO automated control covering that case today, and it is worth being blunt about why: a
// reintroduced TS router would reuse the EXISTING `CriticalRole`/`Successor` Prisma models, which
// are still in the schema (both tables sit in the ledger's `efcoreStranglerWrite`, which REQUIRES
// them to remain in the Prisma schema — scripts/table-ownership.mjs asserts exactly that). So no new
// model is added and the ownership check has nothing to flag. This gap closes when the ownership
// flip (#69) removes both models: after that, reintroducing a TS writer means re-adding a model to
// an `efcore` table, which the ledger check DOES reject. Until #69 lands, the only thing standing
// between a reintroduced unsafe TS succession writer and prod is code review.
// If a TS succession router is ever reintroduced, restore these tripwires with it.
//
// ── teamIntel taxonomy ────────────────────────────────────────────────
//   getTeamProfile / getMembers / getBalanceScore / getBalanceAlerts /
//     getRecommendedHires → all take teamId → assertScoped('team') first.
//   compareTeams        → multi-team read → AND-compose the team fragment.
//   getDashboardKpis    → org-rollup → requireOrgScope.

const ROOT = join(__dirname, '..', '..');
const readRouter = (name: string) => readFileSync(join(ROOT, 'packages/api/src/routers', name), 'utf8');

describe('ninebox module scope wiring', () => {
  const src = () => readRouter('ninebox.ts');

  it('composes the nineBoxEvaluation fragment via AND', () => {
    expect(src()).toMatch(/scopeWhereFor\('nineBoxEvaluation'/);
    expect(src()).toMatch(/AND:\s*\[/);
  });

  it('getAxisBreakdown subjects the target user via assertSubjectInScope', () => {
    expect(src()).toMatch(/assertSubjectInScope/);
  });

  it('submitCalibrationVote enforces the committee-membership rule', () => {
    const s = src();
    // membership check: a calibrationMember.findFirst keyed on the voter
    expect(s).toMatch(/calibrationMember\.findFirst|members:\s*\{\s*some/);
    // FORBIDDEN when the voter is not a member
    expect(s).toMatch(/FORBIDDEN/);
  });

  it('finalizeCalibration (lifecycle write) gated via requireOrgScope', () => {
    expect(src()).toMatch(/requireOrgScope/);
  });
});

// `describe('succession module scope wiring')` REMOVED 2026-08-03 (#58) — succession.ts no
// longer exists. See the succession-taxonomy block above for the C# tests that now carry both
// of its assertions.

describe('teamIntel module scope wiring', () => {
  const src = () => readRouter('teamIntel.ts');

  it('team-keyed endpoints probe via assertScoped(team)', () => {
    expect(src()).toMatch(/assertScoped\('team'/);
  });
});

describe('talent modules — no fragment spread (AND-composition invariant, CI check 13)', () => {
  // 'succession.ts' dropped 2026-08-03 (#58) — file deleted. A deleted router cannot spread a
  // fragment, so this loses no coverage; the C# owner has no Prisma fragment to spread at all.
  for (const name of ['ninebox.ts', 'teamIntel.ts']) {
    it(`${name} does not spread a scope fragment`, () => {
      expect(readRouter(name)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    });
  }
});

describe('codex round-1 fixes (talent)', () => {
  // 'succession nested successors carry the successor fragment' REMOVED 2026-08-03 (#58) —
  // succession.ts deleted. The C# equivalent is a real behavioural test rather than a source
  // grep: TeamScope_ListCriticalRoles_DropsOutOfScopeRole (SuccessionReadTests.cs) asserts an
  // out-of-scope role is actually absent from the response.
  it('submitCalibrationVote validates the evaluated user belongs to the org', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/ninebox.ts'), 'utf8');
    const block = src.slice(src.indexOf('submitCalibrationVote:'), src.indexOf('finalizeCalibration:'));
    expect(block).toMatch(/input\.evaluatedUserId,\s*organizationId/);
    expect(block).toMatch(/Usuario evaluado no encontrado/);
  });
  // 'updateActionPlan guards responsibility reassignment' REMOVED 2026-08-05 (#56) —
  // packages/api/src/routers/engagement.ts no longer declares updateActionPlan (nor
  // createActionPlan); C# is the sole writer of action_plans. Note this tripwire was ALREADY
  // partly hollow: it sliced from `src.indexOf('updateActionPlan')` to end-of-file, so it only
  // ever proved that SOME assertSubjectInScope call appeared after that point, not that the
  // reassignment path carried one. The reassignment guarantee is now behavioural rather than a
  // source grep — EngagementWriteEndpoints.cs:259-262 (assertSubjectInScope on a provided
  // responsibleId) + EngagementWriteRepository.cs:230-231 (the H1 in-org backstop), asserted by
  // services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementWriteTests.cs and
  // .../EngagementWriteEndpointAuthTests.cs. The zero-TS-writer invariant that replaces the whole
  // TS-side family lives in tests/access/scope-wiring-engagement-write.test.ts.
});
