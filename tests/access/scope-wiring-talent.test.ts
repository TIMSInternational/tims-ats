import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 4 — static tripwires for the TALENT modules:
// ninebox (9-box + calibration), succession (critical roles / successors),
// teamIntel (team-keyed analytics). These three carry leader@team grants in
// the matrix, so own/team/unit reads must filter rows.
//
// ── ninebox taxonomy — REMOVED 2026-08-05 (#57) ───────────────────────
// packages/api/src/routers/ninebox.ts is DELETED (with ninebox.schemas.ts and
// ninebox.helpers.ts, and unregistered from root.ts). The 2026-07-29 pass removed 7 of
// 11 reads + 3 of 5 writes; #57 removed the last 6 (getAxisBreakdown, getMovementHistory,
// simulate, getQuadrantPlan, submitCalibrationVote, finalizeCalibration — all
// zero-FE-consumer). There is no TS source file left for a static tripwire to grep, so the
// four ninebox assertions that used to live below are gone rather than skipped.
//
// The guarantees they asserted are enforced against the C# owner as REAL HTTP integration
// tests, which for the LIVE code path is a stronger check than a regex over source
// (services/Tims.Platform/tests/Tims.IntegrationTests/NineBox/):
//   assertSubjectInScope on getAxisBreakdown → NineBoxReadEndpointAuthTests.cs (the
//                                              subject-scope 403 cases)
//   submitCalibrationVote membership rule    → SubmitVote_org_admin_non_member_cannot_forge_or_overwrite
//                                              (NineBoxWriteTests.cs) — a behavioural proof that an
//                                              hr_admin WITH ninebox:update but no membership is denied
//                                              AND writes nothing, which the source grep never showed
//   evaluatedUser-in-org hardening           → SubmitVote_cross_org_evaluated_user_is_not_found,
//                                              SubmitVote_nonexistent_evaluated_user_is_not_found
//   finalizeCalibration requireOrgScope      → NineBoxWriteEndpointAuthTests.cs + Finalize_cross_org_is_null_and_untouched
//
// HONEST LIMIT, same as the succession block below: these are not the same control. The C#
// tests guard the C# implementation. They would NOT catch a future TS ninebox router
// reintroduced without assertSubjectInScope/requireOrgScope. Until flip #70 removes the
// three calibration_* Prisma models, the ledger check has nothing to flag either (the models
// must remain while the tables sit in efcoreStranglerWrite). What DOES cover the part that
// matters for #70 is tests/governance/calibration-no-ts-writers.test.ts — a repo-wide
// tripwire asserting zero Prisma-delegate touches of the three calibration_* models. It
// would fail the moment a TS writer reappears, which is the specific regression that would
// silently un-block-then-corrupt the flip.
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

// `describe('ninebox module scope wiring')` REMOVED 2026-08-05 (#57) — ninebox.ts no longer
// exists. See the ninebox-taxonomy block above for the C# tests that now carry its assertions.

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
  // 'succession.ts' dropped 2026-08-03 (#58) and 'ninebox.ts' dropped 2026-08-05 (#57) — both files
  // deleted. A deleted router cannot spread a fragment, so this loses no coverage; the C# owners
  // have no Prisma fragment to spread at all.
  for (const name of ['teamIntel.ts']) {
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
  // 'submitCalibrationVote validates the evaluated user belongs to the org' REMOVED 2026-08-05
  // (#57) — ninebox.ts deleted. The C# equivalents are behavioural rather than source greps:
  // SubmitVote_cross_org_evaluated_user_is_not_found + SubmitVote_nonexistent_evaluated_user_is_not_found
  // (NineBoxWriteTests.cs) assert the 404 AND that no vote row was written.
  it('updateActionPlan guards responsibility reassignment', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');
    const block = src.slice(src.indexOf('updateActionPlan'));
    expect(block).toMatch(/assertSubjectInScope/);
  });
});
