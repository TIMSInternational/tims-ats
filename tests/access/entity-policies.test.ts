import { describe, it, expect, vi } from 'vitest';
import { scopeWhereFor } from '../../packages/api/src/access/entity-policies';
import type { AccessContext } from '../../packages/api/src/access';

// Fake request-local anchors (the real loader is tested in anchors.test.ts).
const anchors = {
  teamMemberIds: vi.fn(async () => ['me', 'u2']),
  unitIds: vi.fn(async () => ['bu1', 'bu2']),
  panelInterviewIds: vi.fn(async () => ['i1']),
  ledTeamIds: vi.fn(async () => ['t1', 't2']),
  unitMemberIds: vi.fn(async () => ['u1', 'u2']),
};
const ctx = (scope: string): AccessContext =>
  ({ allowed: true, scope, roles: ['x'], anchors }) as unknown as AccessContext;
const ME = 'me';

describe('scopeWhereFor — organization/company scopes are behavior-neutral', () => {
  for (const entity of ['vacancy', 'candidate', 'application', 'interview', 'offer', 'assessmentAssignment'] as const) {
    it(`${entity} @organization → {} (deploy-safety invariant)`, async () => {
      expect(await scopeWhereFor(entity, ctx('organization'), ME)).toEqual({});
    });
    it(`${entity} @company → {} (no company anchors exist; treated as org)`, async () => {
      expect(await scopeWhereFor(entity, ctx('company'), ME)).toEqual({});
    });
  }
});

describe('scopeWhereFor — vacancy', () => {
  it('team → OR(teamId in ledTeamIds, assignedTo me)', async () => {
    expect(await scopeWhereFor('vacancy', ctx('team'), ME)).toEqual({
      OR: [{ teamId: { in: ['t1', 't2'] } }, { assignedTo: ME }],
    });
  });
  it('unit → businessUnitId in unitIds', async () => {
    expect(await scopeWhereFor('vacancy', ctx('unit'), ME)).toEqual({
      businessUnitId: { in: ['bu1', 'bu2'] },
    });
  });
  it('own → OR(assignedTo me, createdBy me)', async () => {
    expect(await scopeWhereFor('vacancy', ctx('own'), ME)).toEqual({
      OR: [{ assignedTo: ME }, { createdBy: ME }],
    });
  });
});

describe('scopeWhereFor — via-vacancy entities wrap the vacancy fragment', () => {
  // Codex F5: nested vacancy fragments must also exclude soft-deleted vacancies,
  // otherwise a narrow scope can anchor visibility through a deleted vacancy.
  // The nested form is {vacancy: {AND: [<vacFrag>, {deletedAt: null}]}}.
  it('application/offer/assessmentAssignment @unit → {vacancy: AND[<unit frag>, deletedAt null]}', async () => {
    for (const entity of ['application', 'offer', 'assessmentAssignment'] as const) {
      expect(await scopeWhereFor(entity, ctx('unit'), ME)).toEqual({
        vacancy: { AND: [{ businessUnitId: { in: ['bu1', 'bu2'] } }, { deletedAt: null }] },
      });
    }
  });
  it('candidate scopes via applications.some.vacancy (deleted-vacancy guarded)', async () => {
    // `some` (NOT `every`) is design invariant #5: a candidate is visible iff
    // ANY of their applications targets an in-scope vacancy — the org always
    // sees candidates applying to its positions. Tightening to `every` would
    // hide multi-application candidates and break the invariant.
    expect(await scopeWhereFor('candidate', ctx('team'), ME)).toEqual({
      applications: { some: { vacancy: { AND: [{ OR: [{ teamId: { in: ['t1', 't2'] } }, { assignedTo: ME }] }, { deletedAt: null }] } } },
    });
  });
  it('candidate @unit wraps the unit vacancy fragment (deleted-vacancy guarded)', async () => {
    expect(await scopeWhereFor('candidate', ctx('unit'), ME)).toEqual({
      applications: { some: { vacancy: { AND: [{ businessUnitId: { in: ['bu1', 'bu2'] } }, { deletedAt: null }] } } },
    });
  });
});

describe('scopeWhereFor — interview adds the panel arm', () => {
  it('team → OR(vacancy team fragment, evaluators some me) — leader OR committee panel', async () => {
    expect(await scopeWhereFor('interview', ctx('team'), ME)).toEqual({
      OR: [
        { vacancy: { AND: [{ OR: [{ teamId: { in: ['t1', 't2'] } }, { assignedTo: ME }] }, { deletedAt: null }] } },
        { evaluators: { some: { userId: ME } } },
      ],
    });
  });
  it('own → evaluators some me (panel only)', async () => {
    expect(await scopeWhereFor('interview', ctx('own'), ME)).toEqual({
      evaluators: { some: { userId: ME } },
    });
  });
  it('unit → OR(vacancy unit fragment, evaluators some me)', async () => {
    expect(await scopeWhereFor('interview', ctx('unit'), ME)).toEqual({
      OR: [
        { vacancy: { AND: [{ businessUnitId: { in: ['bu1', 'bu2'] } }, { deletedAt: null }] } },
        { evaluators: { some: { userId: ME } } },
      ],
    });
  });
});

describe('scopeWhereFor — people entities (user-anchored)', () => {
  for (const entity of ['okr', 'onboardingPlan', 'enrollment', 'certificate', 'nineBoxEvaluation', 'successor', 'employeeCompensation', 'salaryAdjustment'] as const) {
    it(`${entity} @organization → {} (deploy-safety invariant)`, async () => {
      expect(await scopeWhereFor(entity, ctx('organization'), ME)).toEqual({});
    });
  }

  it('okr team → userId in teamMemberIds', async () => {
    expect(await scopeWhereFor('okr', ctx('team'), ME)).toEqual({ userId: { in: ['me', 'u2'] } });
  });
  it('okr unit → userId in unitMemberIds', async () => {
    expect(await scopeWhereFor('okr', ctx('unit'), ME)).toEqual({ userId: { in: ['u1', 'u2'] } });
  });
  it('leaderCommitment anchors on leaderId (own scalar, team in-list)', async () => {
    expect(await scopeWhereFor('leaderCommitment', ctx('own'), ME)).toEqual({ leaderId: ME });
    expect(await scopeWhereFor('leaderCommitment', ctx('team'), ME)).toEqual({ leaderId: { in: ['me', 'u2'] } });
    expect(await scopeWhereFor('leaderCommitment', ctx('organization'), ME)).toEqual({});
  });

  it('okr own → userId me', async () => {
    expect(await scopeWhereFor('okr', ctx('own'), ME)).toEqual({ userId: ME });
  });

  it('coachingSession adds the coach arm (leaderId) at every narrow scope', async () => {
    expect(await scopeWhereFor('coachingSession', ctx('team'), ME)).toEqual({
      OR: [{ employeeId: { in: ['me', 'u2'] } }, { leaderId: ME }],
    });
    expect(await scopeWhereFor('coachingSession', ctx('own'), ME)).toEqual({
      OR: [{ employeeId: ME }, { leaderId: ME }],
    });
  });

  it('feedback: subject is the recipient; own adds the giver arm', async () => {
    expect(await scopeWhereFor('feedback', ctx('team'), ME)).toEqual({
      OR: [{ toUserId: { in: ['me', 'u2'] } }, { fromUserId: ME }],
    });
    expect(await scopeWhereFor('feedback', ctx('own'), ME)).toEqual({
      OR: [{ toUserId: ME }, { fromUserId: ME }],
    });
  });

  it('onboardingPlan adds the buddy arm', async () => {
    expect(await scopeWhereFor('onboardingPlan', ctx('team'), ME)).toEqual({
      OR: [{ userId: { in: ['me', 'u2'] } }, { buddyId: ME }],
    });
  });

  it('criticalRole anchors on currentHolderId (nullable → no null-match)', async () => {
    expect(await scopeWhereFor('criticalRole', ctx('team'), ME)).toEqual({
      currentHolderId: { in: ['me', 'u2'] },
    });
  });

  it('team entity: team scope → led teams; unit → unit teams', async () => {
    expect(await scopeWhereFor('team', ctx('team'), ME)).toEqual({ id: { in: ['t1', 't2'] } });
    expect(await scopeWhereFor('team', ctx('unit'), ME)).toEqual({ businessUnitId: { in: ['bu1', 'bu2'] } });
    expect(await scopeWhereFor('team', ctx('own'), ME)).toEqual({ id: { in: ['t1', 't2'] } });
  });
});

describe('scopeWhereFor — actionPlan (engagement, responsibleId anchor)', () => {
  it('actionPlan @organization → {} (deploy-safety invariant)', async () => {
    expect(await scopeWhereFor('actionPlan', ctx('organization'), ME)).toEqual({});
  });
  it('actionPlan own → responsibleId me (scalar)', async () => {
    expect(await scopeWhereFor('actionPlan', ctx('own'), ME)).toEqual({ responsibleId: ME });
  });
  it('actionPlan team → responsibleId in teamMemberIds', async () => {
    expect(await scopeWhereFor('actionPlan', ctx('team'), ME)).toEqual({ responsibleId: { in: ['me', 'u2'] } });
  });
  it('actionPlan unit → responsibleId in unitMemberIds', async () => {
    expect(await scopeWhereFor('actionPlan', ctx('unit'), ME)).toEqual({ responsibleId: { in: ['u1', 'u2'] } });
  });
});

describe('scopeWhereFor — fail-closed edges', () => {
  it('narrow scope with null anchors → throws (never silently unscoped)', async () => {
    const noAnchors = { allowed: true, scope: 'team', roles: ['x'], anchors: null } as unknown as AccessContext;
    await expect(scopeWhereFor('vacancy', noAnchors, ME)).rejects.toThrow();
  });
  it('unknown entity → throws', async () => {
    await expect(scopeWhereFor('payroll' as never, ctx('team'), ME)).rejects.toThrow();
  });
  it('unknown scope → throws', async () => {
    await expect(scopeWhereFor('vacancy', ctx('galaxy'), ME)).rejects.toThrow();
  });
});
