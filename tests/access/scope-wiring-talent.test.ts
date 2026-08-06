import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
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
// reintroduced without assertSubjectInScope/requireOrgScope.
//
// UPDATED 2026-08-06 — FLIP #70 EXECUTED. This paragraph used to read "Until flip #70 removes
// the three calibration_* Prisma models, the ledger check has nothing to flag either (the
// models must remain while the tables sit in efcoreStranglerWrite)." That is now false: the
// three models are deleted and the tables are `efcore` in docs/architecture/table-ownership.md,
// so re-adding any of them IS a `cross-owner collision` (table-ownership.mjs:113-117), and a TS
// Prisma reader of them no longer compiles. tests/governance/calibration-no-ts-writers.test.ts
// still carries the finer guard — a repo-wide tripwire asserting zero Prisma-delegate touches,
// zero nested-back-relation writes and zero runtime raw DML, plus (inverted at flip time) that
// the ledger keeps classifying all three as efcore.
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
// ── teamIntel taxonomy — HISTORICAL as of 2026-08-06 (#55) ────────────
// This is the taxonomy the DELETED TS router implemented. It is kept as the specification the C#
// owner is held to (and as the checklist to restore from if a TS teamIntel router ever returns):
//   getTeamProfile / getMembers / getBalanceScore / getBalanceAlerts /
//     getRecommendedHires → all take teamId → assertScoped('team') first.
//   compareTeams        → multi-team read → AND-compose the team fragment.
//   getDashboardKpis    → org-rollup → requireOrgScope.
// All seven are mapped in C# at TeamIntelReadEndpoints.cs:38-280 with the same shape: the staff
// gate first, then the team IDOR probe (1-5, incl. the two 501 stubs), ScopeWhereFor for
// compareTeams (:222), and OrgGate for dashboard-kpis (:267).

const ROOT = join(__dirname, '..', '..');
// The `readRouter` helper was dropped with the teamIntel block (#55): all three talent routers it
// read (ninebox.ts, succession.ts, teamIntel.ts) are now deleted, so it had no caller left.

// `describe('ninebox module scope wiring')` REMOVED 2026-08-05 (#57) — ninebox.ts no longer
// exists. See the ninebox-taxonomy block above for the C# tests that now carry its assertions.

// `describe('succession module scope wiring')` REMOVED 2026-08-03 (#58) — succession.ts no
// longer exists. See the succession-taxonomy block above for the C# tests that now carry both
// of its assertions.

// ── teamIntel — REMOVED 2026-08-06 (#55), and INVERTED rather than deleted ────────────
// packages/api/src/routers/teamIntel.ts is DELETED (unregistered from root.ts). #55 removed the
// last 6 procedures (getTeamProfile, getMembers, getBalanceScore, getBalanceAlerts,
// getRecommendedHires, compareTeams — all zero-FE-consumer); getDashboardKpis went on 2026-07-28.
//
// The assertions that used to live here were `assertScoped('team')` and the no-fragment-spread
// grep. Their guarantees are enforced against the C# owner as REAL HTTP integration tests
// (services/Tims.Platform/tests/Tims.IntegrationTests/TeamIntel/):
//   assertScoped('team') on the 5 id-keyed reads → TeamIntelReadEndpointAuthTests.cs:126-142
//       TeamScope_OutOfScopeTeam_Is404_IdorProbe, a [Theory] over profile / members /
//       balance-score / balance-alerts / recommended-hires — a behavioural 404 for an
//       out-of-scope team, which a source grep never showed. Its control that the 404 is SCOPE
//       and not RLS is OrgScope_OutOfTeamProfile_Is200 (:145).
//   scopeWhereFor('team') AND-composition on compareTeams → TeamScope_Compare_DropsOutOfScopeTeam
//       (:207) asserts the out-of-scope teamId is actually ABSENT from the response, with
//       OrgScope_Compare_ReturnsBothTeams (:193) as the positive control.
//   the two 501 stubs probe BEFORE returning → OrgScope_Stubs_Are501 (:183).
//
// UNLIKE the ninebox/succession blocks above, this one does NOT simply disappear. Both of those
// record — in this same file — that removing the tripwire leaves "NO automated control" against a
// TS router being reintroduced without its scope wiring. So the pin is INVERTED instead of
// deleted: the router is pinned BY NAME as absent. Reintroducing it turns this suite RED, which
// forces whoever does it to restore the two assertions above rather than silently shipping an
// unscoped router. That is strictly more coverage than the ninebox/succession precedent left.
//
// The no-fragment-spread loop is NOT re-created: it would now iterate zero times while still
// reading as a live check (the exact vacuous-pass defect the #57 review caught in
// surfaces.test.ts). It was already redundant — the AND-composition invariant is enforced
// repo-wide over packages/api/src by CI check 13 (.github/workflows/ci.yml:153, .claude/commands/gate.md:54),
// which covers any router added tomorrow, not just a hardcoded list.
describe('teamIntel router stays deleted (#55) — inverted tripwire', () => {
  const TEAM_INTEL_ROUTER = join(ROOT, 'packages/api/src/routers', 'teamIntel.ts');

  it('packages/api/src/routers/teamIntel.ts does not exist; reintroducing it must restore the scope tripwires', () => {
    expect(existsSync(TEAM_INTEL_ROUTER)).toBe(false);
  });

  // NON-VACUITY. The assertion above is an existsSync(...)===false, which also passes when ROOT is
  // wrong and the path resolves to nothing at all. Pin two sibling artifacts BY NAME so a broken
  // ROOT / moved routers directory fails loudly here instead of certifying an absence it never checked.
  it('the routers directory it guards is really there (non-vacuity control)', () => {
    expect(existsSync(join(ROOT, 'packages/api/src/routers'))).toBe(true);
    expect(existsSync(join(ROOT, 'packages/api/src/routers', 'engagement.ts'))).toBe(true);
  });

  // And that teamIntel is genuinely unmounted, not merely moved out of routers/ — root.ts is the
  // file that decides whether the procedures are reachable over tRPC at all.
  it('root.ts no longer mounts a teamIntel router', () => {
    const root = readFileSync(join(ROOT, 'packages/api/src/root.ts'), 'utf8');
    expect(root).not.toMatch(/^\s*teamIntel:/m);
    expect(root).not.toMatch(/^import .*routers\/teamIntel'/m);
  });
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
