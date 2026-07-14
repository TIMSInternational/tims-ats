import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { submitRatingsInput } from '../../packages/api/src/routers/evaluation360';

// Sprint 1.7 Slice 3 — evaluation360 router self-service procedures
// (myRaterTasks/submitRatings). CRITICAL DESIGN: these are IDENTITY-ANCHORED
// (every repo call keyed to ctx.user.id as the rater), NOT scope-aware. They
// must NEVER call requireOrgScope (that's the org-admin gate — Slice 2) or
// assertScoped/scopeWhereFor (those resolve to {} for an org-scoped caller
// like super_admin/hr_admin, which would let an admin submit/read on behalf
// of another rater — forged feedback). Follows the established static-source
// wiring-assertion pattern used by tests/access/scope-wiring-evaluation360.ts
// (see that file's docstring for why: no precedent in this repo for invoking
// a permissionProcedure-gated router endpoint via appRouter.createCaller with
// a mocked ctx.access/DB).

const ROOT = join(__dirname, '..', '..');
const src = () => readFileSync(join(ROOT, 'packages/api/src/routers/evaluation360.ts'), 'utf8');

const SIX_RATINGS = [
  { competencyKey: 'leadership' as const, rating: 4 },
  { competencyKey: 'communication' as const, rating: 4 },
  { competencyKey: 'collaboration' as const, rating: 4 },
  { competencyKey: 'execution' as const, rating: 4 },
  { competencyKey: 'adaptability' as const, rating: 4 },
  { competencyKey: 'integrity' as const, rating: 4 },
];

describe('submitRatingsInput (zod)', () => {
  const ASSIGNMENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts exactly 6 ratings, one per competency, rating 1-5, optional bounded comment', () => {
    const result = submitRatingsInput.safeParse({
      assignmentId: ASSIGNMENT_ID,
      ratings: SIX_RATINGS.map((r) => ({ ...r, comment: 'ok' })),
    });
    expect(result.success).toBe(true);
  });

  it('rejects 5 ratings (missing one competency)', () => {
    const result = submitRatingsInput.safeParse({
      assignmentId: ASSIGNMENT_ID,
      ratings: SIX_RATINGS.slice(0, 5),
    });
    expect(result.success).toBe(false);
  });

  it('rejects 6 ratings with a duplicate competencyKey (even though length is 6)', () => {
    const dupRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'leadership' as const, rating: 3 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: dupRatings });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown competencyKey', () => {
    const badRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'not_a_competency', rating: 3 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a rating outside 1-5', () => {
    const badRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'integrity' as const, rating: 6 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a comment over 5000 chars', () => {
    const badRatings = [
      ...SIX_RATINGS.slice(0, 5),
      { competencyKey: 'integrity' as const, rating: 3, comment: 'x'.repeat(5001) },
    ];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid assignmentId', () => {
    const result = submitRatingsInput.safeParse({ assignmentId: 'not-a-uuid', ratings: SIX_RATINGS });
    expect(result.success).toBe(false);
  });
});

describe('evaluation360 router — self-service procedures are identity-anchored, NOT scope-aware', () => {
  // Fix wave (Important — RBAC over-restriction, opus): self-service
  // authorization is IDENTITY (raterUserId/subjectUserId === ctx.user.id),
  // not an RBAC grant, so these four use protectedProcedure — any staff role
  // can be legitimately assigned as a rater without an evaluation360 grant.
  // protectedProcedure provides no ctx.access, so this also proves the four
  // resolvers cannot depend on it.
  it('myRaterTasks, submitRatings, myReport, and myReportCycles use protectedProcedure, not permissionProcedure', () => {
    const body = src();
    expect(body).toMatch(/\n {2}myRaterTasks: protectedProcedure\b/);
    expect(body).toMatch(/\n {2}submitRatings: protectedProcedure\b/);
    expect(body).toMatch(/\n {2}myReport: protectedProcedure\b/);
    expect(body).toMatch(/\n {2}myReportCycles: protectedProcedure\b/);
  });

  it('the seven admin procedures still use permissionProcedure', () => {
    const body = src();
    for (const proc of [
      'createCycle',
      'openCycle',
      'closeCycle',
      'publishCycle',
      'assignRaters',
      'listCycles',
      'getCycleProgress',
    ]) {
      expect(body, `${proc} must still use permissionProcedure`).toMatch(
        new RegExp(`\\n {2}${proc}: permissionProcedure\\(`),
      );
    }
  });

  it('myRaterTasks, submitRatings, myReport, and myReportCycles resolver bodies never call requireOrgScope or assertScoped/scopeWhereFor', () => {
    const body = src();
    for (const proc of ['myRaterTasks', 'submitRatings', 'myReport', 'myReportCycles']) {
      const start = body.indexOf(`${proc}:`);
      expect(start, `${proc} not found in router source`).toBeGreaterThanOrEqual(0);
      const nextProcMatch = body
        .slice(start + proc.length)
        .search(/\n {2}[a-zA-Z]+: (permissionProcedure|protectedProcedure)\(/);
      const end = nextProcMatch === -1 ? body.length : start + proc.length + nextProcMatch;
      const block = body.slice(start, end);
      expect(block, `${proc} must not call requireOrgScope`).not.toMatch(/requireOrgScope/);
      expect(block, `${proc} must not call assertScoped`).not.toMatch(/assertScoped/);
      expect(block, `${proc} must not call scopeWhereFor`).not.toMatch(/scopeWhereFor/);
    }
  });

  it('myRaterTasks and submitRatings key their service calls to ctx.user.id (the caller) as the rater — never a client-supplied raterUserId', () => {
    const body = src();
    const myRaterTasksStart = body.indexOf('myRaterTasks:');
    const submitRatingsStart = body.indexOf('submitRatings:');
    expect(myRaterTasksStart).toBeGreaterThanOrEqual(0);
    expect(submitRatingsStart).toBeGreaterThanOrEqual(0);

    const myRaterTasksBlock = body.slice(myRaterTasksStart, submitRatingsStart);
    expect(myRaterTasksBlock).toMatch(/ctx\.user\.id/);
    expect(myRaterTasksBlock).toMatch(/ctx\.user\.organizationId/);

    const myReportStart = body.indexOf('myReport:');
    expect(myReportStart).toBeGreaterThanOrEqual(0);
    const submitRatingsBlock = body.slice(submitRatingsStart, myReportStart);
    expect(submitRatingsBlock).toMatch(/ctx\.user\.id/);
    expect(submitRatingsBlock).toMatch(/ctx\.user\.organizationId/);
  });

  it('myReport keys its service call to ctx.user.id as the SUBJECT — never a client-supplied subjectUserId, and takes no such input field', () => {
    const body = src();
    const myReportStart = body.indexOf('myReport:');
    expect(myReportStart).toBeGreaterThanOrEqual(0);
    const myReportBlock = body.slice(myReportStart);
    expect(myReportBlock).toMatch(/ctx\.user\.id/);
    expect(myReportBlock).toMatch(/ctx\.user\.organizationId/);
    expect(myReportBlock).not.toMatch(/subjectUserId/);
    // myReport uses the shared cycleIdInput ({ cycleId }) — no subject id in its zod input.
    expect(myReportBlock).toMatch(/\.input\(cycleIdInput\)/);
  });

  it('myReportCycles keys its service call to ctx.user.id/ctx.user.organizationId and takes no client-supplied subject id (no input at all)', () => {
    const body = src();
    const myReportCyclesStart = body.indexOf('myReportCycles:');
    expect(myReportCyclesStart).toBeGreaterThanOrEqual(0);
    const block = body.slice(myReportCyclesStart);
    expect(block).toMatch(/ctx\.user\.id/);
    expect(block).toMatch(/ctx\.user\.organizationId/);
    expect(block).not.toMatch(/subjectUserId/);
    expect(block).not.toMatch(/\.input\(/);
  });

  it('raterAssignment is not registered as a ScopedEntity (no assertScoped delegate) — confirms identity-anchoring is the only guard, by design', () => {
    const entityPolicies = readFileSync(join(ROOT, 'packages/api/src/access/entity-policies.ts'), 'utf8');
    const scopedProbe = readFileSync(join(ROOT, 'packages/api/src/access/scoped-probe.ts'), 'utf8');
    expect(entityPolicies).not.toMatch(/raterAssignment/);
    expect(scopedProbe).not.toMatch(/raterAssignment/);
  });
});
