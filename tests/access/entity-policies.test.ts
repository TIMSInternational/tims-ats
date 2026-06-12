import { describe, it, expect, vi } from 'vitest';
import { scopeWhereFor } from '../../packages/api/src/access/entity-policies';
import type { AccessContext } from '../../packages/api/src/access';

// Fake request-local anchors (the real loader is tested in anchors.test.ts).
const anchors = {
  teamMemberIds: vi.fn(async () => ['me', 'u2']),
  unitIds: vi.fn(async () => ['bu1', 'bu2']),
  panelInterviewIds: vi.fn(async () => ['i1']),
  ledTeamIds: vi.fn(async () => ['t1', 't2']),
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
