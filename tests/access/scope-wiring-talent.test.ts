import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 4 — static tripwires for the TALENT modules:
// ninebox (9-box + calibration), succession (critical roles / successors),
// teamIntel (team-keyed analytics). These three carry leader@team grants in
// the matrix, so own/team/unit reads must filter rows.
//
// ── ninebox taxonomy ──────────────────────────────────────────────────
//   getGrid / getAxisBreakdown / getMovementHistory → row-level reads of
//     NineBoxEvaluation → AND-compose the nineBoxEvaluation fragment (the
//     existing teamId/unitId/companyId input branches only INTERSECT).
//   getEmployeeDetail   → point-read of one employee → assertSubjectInScope.
//   simulate            → pure math on input scores (no DB read) → untouched.
//   createCalibration   → session creation is an org-governance act (not a
//     committee grant) → requireOrgScope.
//   getCalibration      → org-scoped + member-or-creator check.
//   submitCalibrationVote → THE membership rule (mirrors submitScorecard):
//     fetch session org-scoped, require the VOTER is a calibrationMember,
//     FORBIDDEN otherwise. voterId already comes from ctx.user.id (not input).
//   finalizeCalibration → session lifecycle write → requireOrgScope.
//   getQuadrantPlan     → static plan lookup (no DB read) → untouched.
//   getBenchStrength / getDashboardKpis → org-rollup aggregates → requireOrgScope.
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

  it('getEmployeeDetail subjects the target user via assertSubjectInScope', () => {
    expect(src()).toMatch(/assertSubjectInScope/);
  });

  it('submitCalibrationVote enforces the committee-membership rule', () => {
    const s = src();
    // membership check: a calibrationMember.findFirst keyed on the voter
    expect(s).toMatch(/calibrationMember\.findFirst|members:\s*\{\s*some/);
    // FORBIDDEN when the voter is not a member
    expect(s).toMatch(/FORBIDDEN/);
  });

  it('org-rollup / lifecycle endpoints gated via requireOrgScope', () => {
    expect(src()).toMatch(/requireOrgScope/);
  });

  // Slice 5A — committee "Mis Calibraciones": a member-scoped read of the
  // caller's OWN calibration sessions. Mirrors getCalibration's member-anchor
  // (createdById OR a CalibrationMember row), NOT requireOrgScope, NOT
  // scopeWhereFor (calibrationSession is not a registered ENTITY).
  describe('myCalibrations (committee landing)', () => {
    // Isolate the procedure block so requireOrgScope on OTHER endpoints can't
    // satisfy these assertions.
    const block = () => {
      const s = src();
      const start = s.indexOf('myCalibrations:');
      expect(start).toBeGreaterThan(-1);
      // next top-level procedure after myCalibrations
      const rest = s.slice(start + 'myCalibrations:'.length);
      const nextProc = rest.search(/\n {2}\w+:\s*permissionProcedure/);
      return nextProc === -1 ? rest : rest.slice(0, nextProc);
    };

    it('anchors on createdById OR a CalibrationMember userId (own/member, not org-wide)', () => {
      const b = block();
      expect(b).toMatch(/createdById:\s*ctx\.user\.id/);
      expect(b).toMatch(/members:\s*\{\s*some:\s*\{\s*userId:\s*ctx\.user\.id/);
      expect(b).toMatch(/OR:\s*\[/);
    });

    it('does NOT use requireOrgScope (committee is team-scoped)', () => {
      expect(block()).not.toMatch(/requireOrgScope/);
    });

    it('does NOT call scopeWhereFor for calibrationSession (not a registered ENTITY)', () => {
      expect(block()).not.toMatch(/scopeWhereFor\('calibrationSession'/);
    });

    it('always filters by organizationId (tenant isolation)', () => {
      expect(block()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
    });

    it('uses an explicit select (no full-record leak) and bounds the list', () => {
      const b = block();
      expect(b).toMatch(/select:\s*\{/);
      expect(b).toMatch(/take:\s*\d+/);
    });
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
