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
// ── succession taxonomy ───────────────────────────────────────────────
//   listCriticalRoles / getCriticalRole → row-level → AND-compose criticalRole.
//   addCriticalRole     → defining org-critical roles is org governance →
//     requireOrgScope.
//   addSuccessor        → assertSubjectInScope on the successor's userId +
//     assertScoped('criticalRole') on the parent role.
//   removeSuccessor / updateSuccessorReadiness → assertScoped('successor').
//   getFlightRisk / getCompetencyCoverage / getRolesWithoutSuccessor /
//     simulateExit / getDashboardKpis → org-rollup analytics → requireOrgScope.
//
// ── teamIntel taxonomy ────────────────────────────────────────────────
//   getTeamProfile / getMembers / getBalanceScore / getBalanceAlerts /
//     getRecommendedHires → all take teamId → assertScoped('team') first.
//   compareTeams        → multi-team read → AND-compose the team fragment.
//   getDashboardKpis    → org-rollup → requireOrgScope.

const ROOT = join(__dirname, '..', '..');
const readRouter = (name: string) =>
  readFileSync(join(ROOT, 'packages/api/src/routers', name), 'utf8');

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

describe('succession module scope wiring', () => {
  const src = () => readRouter('succession.ts');

  it('successor mutations are scope-probed (assertScoped / assertSubjectInScope)', () => {
    expect(src()).toMatch(/assertScoped\('successor'|assertSubjectInScope/);
  });

  it('org-governance / rollup endpoints gated via requireOrgScope', () => {
    expect(src()).toMatch(/requireOrgScope/);
  });
});

describe('teamIntel module scope wiring', () => {
  const src = () => readRouter('teamIntel.ts');

  it('team-keyed endpoints probe via assertScoped(team)', () => {
    expect(src()).toMatch(/assertScoped\('team'/);
  });
});

describe('talent modules — no fragment spread (AND-composition invariant, CI check 13)', () => {
  for (const name of ['ninebox.ts', 'succession.ts', 'teamIntel.ts']) {
    it(`${name} does not spread a scope fragment`, () => {
      expect(readRouter(name)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    });
  }
});

describe('codex round-1 fixes (talent)', () => {
  it('succession nested successors carry the successor fragment', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/succession.ts'), 'utf8');
    expect((src.match(/where:\s*successorScope/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
  it('submitCalibrationVote validates the evaluated user belongs to the org', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/ninebox.ts'), 'utf8');
    const block = src.slice(src.indexOf('submitCalibrationVote:'), src.indexOf('finalizeCalibration:'));
    expect(block).toMatch(/input\.evaluatedUserId,\s*organizationId/);
    expect(block).toMatch(/Usuario evaluado no encontrado/);
  });
  it('updateActionPlan guards responsibility reassignment', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');
    const block = src.slice(src.indexOf('updateActionPlan'));
    expect(block).toMatch(/assertSubjectInScope/);
  });
});
