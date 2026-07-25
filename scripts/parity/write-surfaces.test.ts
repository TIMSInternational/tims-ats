import { describe, it, expect } from 'vitest';
import {
  WRITE_SURFACES,
  WRITE_EVAL_CYCLES,
  WRITE_CYCLE_MARKER,
  EVAL360_COMPETENCIES,
  type WriteResolved,
  type Evaluation360WriteResolved,
} from './write-surfaces';

const res: WriteResolved = {
  base: 'http://c',
  userIdByRole: { super_admin: 'S', hr_admin: 'H', hrbp: 'B' },
  subjectA: 'subjA',
  subjectB: 'subjB',
  resourceA: 'resA',
  resourceB: 'resB',
};

describe('WRITE_SURFACES compensation', () => {
  const s = WRITE_SURFACES['compensation'];

  it('registers the 2 compensation writes under the single write flag', () => {
    expect(s.flag).toBe('Platform__CompensationWriteEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name)).toEqual(['create-adjustment', 'approve-adjustment']);
  });

  it('create: parity targets the org-A subject, IDOR targets the org-B subject (same POST path)', () => {
    const ep = s.endpoints.find((e) => e.name === 'create-adjustment')!;
    expect(ep.buildParity(res)).toEqual({ path: '/compensation/adjustments', body: expect.objectContaining({ userId: 'subjA', type: 'merit', newSalary: 66000 }) });
    expect(ep.buildIdor!(res).body).toMatchObject({ userId: 'subjB' });
    expect(ep.expectedByRole).toEqual({ super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' });
  });

  it('create: response golden requires status=pending + a uuid id', () => {
    const ep = s.endpoints.find((e) => e.name === 'create-adjustment')!;
    expect(ep.expectResponse({ id: '11111111-1111-4111-8111-111111111111', status: 'pending' })).toBeNull();
    expect(ep.expectResponse({ id: 'x', status: 'pending' })).toContain('uuid');
    expect(ep.expectResponse({ id: '11111111-1111-4111-8111-111111111111', status: 'approved' })).toContain('pending');
  });

  it('approve: parity approves the org-A resource id, IDOR the org-B resource id (path-embedded)', () => {
    const ep = s.endpoints.find((e) => e.name === 'approve-adjustment')!;
    expect(ep.buildParity(res).path).toBe('/compensation/adjustments/resA/approve');
    expect(ep.buildIdor!(res).path).toBe('/compensation/adjustments/resB/approve');
    expect(ep.buildParity(res).body).toEqual({ approved: true });
  });

  it('approve: no-mutation golden checks BOTH the adjustment (pending) AND the salary (unchanged)', () => {
    const ep = s.endpoints.find((e) => e.name === 'approve-adjustment')!;
    const nm = ep.readbackNoMutation(res, 'b');
    expect(nm.params).toEqual(['resB']);
    expect(nm.expect([{ status: 'pending', approved_by_id: null, current_salary: 60000 }])).toBeNull();
    expect(nm.expect([{ status: 'approved', approved_by_id: 'x', current_salary: 66000 }])).toContain('mutated');
    // the critical M2 case: adjustment still pending but the SALARY was flipped → a comp write-leak must FAIL.
    expect(nm.expect([{ status: 'pending', approved_by_id: null, current_salary: 66000 }])).toContain('LEAKED');
    expect(nm.expect([])).toContain('missing');
  });

  it('create: mutated golden self-locates by reason=parity + requester and verifies the response id matches', () => {
    const ep = s.endpoints.find((e) => e.name === 'create-adjustment')!;
    const rb = ep.readbackMutated(res, { id: 'new-1', status: 'pending' });
    expect(rb.params).toEqual(['subjA', 'S']); // by (subjectA, probe requester) — NOT the response id
    expect(rb.expect([{ id: 'new-1', status: 'pending', new_salary: 66000, requested_by_id: 'S', approved_by_id: null }])).toBeNull();
    // a stale/other id echoed by the SUT → the located (real) row id != response id → FAIL.
    expect(rb.expect([{ id: 'seed-fixture', new_salary: 66000, approved_by_id: null }])).toContain('stale/wrong id');
    expect(rb.expect([])).toContain('no freshly-created');
  });

  it('create: allowRolesLiveTestable + readbackAllow exercise a non-probe grant', () => {
    const ep = s.endpoints.find((e) => e.name === 'create-adjustment')!;
    expect(ep.allowRolesLiveTestable).toBe(true);
    const arb = ep.readbackAllow!(res, 'hr_admin', { id: 'h-1' });
    expect(arb.params).toEqual(['subjA', 'H']); // located by hr_admin as the requester
    expect(arb.expect([{ id: 'h-1' }])).toBeNull();
    expect(arb.expect([{ id: 'other' }])).toContain('response id != created row id');
  });

  it('approve: mutated golden requires status=approved + probe approver + comp current_salary=66000', () => {
    const ep = s.endpoints.find((e) => e.name === 'approve-adjustment')!;
    const rb = ep.readbackMutated(res, { id: 'resA', status: 'approved' });
    expect(rb.params).toEqual(['resA']);
    expect(rb.expect([{ status: 'approved', approved_by_id: 'S', current_salary: 66000 }])).toBeNull();
    expect(rb.expect([{ status: 'approved', approved_by_id: 'S', current_salary: 60000 }])).toContain('side effect');
    expect(rb.expect([{ status: 'approved', approved_by_id: 'other', current_salary: 66000 }])).toContain('approved_by_id');
  });

  it('create no-mutation keys on (subject, requester) so it detects only the forbidden insert', () => {
    const ep = s.endpoints.find((e) => e.name === 'create-adjustment')!;
    const idor = ep.readbackNoMutation(res, 'b');
    expect(idor.params).toEqual(['subjB', 'S']); // org-B subject, attacked-by the org-A probe
    const deny = ep.readbackNoMutation(res, 'a', 'hrbp');
    expect(deny.params).toEqual(['subjA', 'B']); // org-A subject, attempted-by hrbp
    expect(idor.expect([{ n: 0 }])).toBeNull();
    expect(idor.expect([{ n: 1 }])).toContain('inserted');
  });
});

describe('WRITE_SURFACES evaluation360', () => {
  const s = WRITE_SURFACES['evaluation360'];
  const er: Evaluation360WriteResolved = {
    base: 'http://c',
    userIdByRole: { super_admin: 'S', hr_admin: 'H', hrbp: 'B' },
    subjectA: 'H',
    submitAssignA: 'asgA',
    submitAssignB: 'asgB',
  };
  const ep = (name: string) => s.endpoints.find((e) => e.name === name)!;

  it('registers the 6 eval360 writes under the single write flag', () => {
    expect(s.flag).toBe('Platform__Evaluation360WriteEnabled');
    expect(s.probeRole).toBe('super_admin');
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'create-cycle', 'open-cycle', 'close-cycle', 'publish-cycle', 'assign-raters', 'submit-ratings',
    ]);
  });

  it('create-cycle: unconditional create, NO IDOR target, allow-role live-testable', () => {
    const e = ep('create-cycle');
    expect(e.buildIdor).toBeUndefined(); // org fixed by caller context → no cross-org target
    expect(e.buildParity(er)).toEqual({ path: '/evaluation360/cycles', body: { name: WRITE_CYCLE_MARKER } });
    expect(e.expectedByRole).toEqual({ super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' });
    expect(e.allowRolesLiveTestable).toBe(true);
    expect(e.expectResponse({ id: '11111111-1111-4111-8111-111111111111', name: WRITE_CYCLE_MARKER, status: 'draft' })).toBeNull();
    expect(e.expectResponse({ id: '11111111-1111-4111-8111-111111111111', name: WRITE_CYCLE_MARKER, status: 'open' })).toContain('draft');
    expect(e.expectResponse({ id: 'x', name: WRITE_CYCLE_MARKER, status: 'draft' })).toContain('uuid');
    expect(e.expectResponse({ id: '11111111-1111-4111-8111-111111111111', name: 'other', status: 'draft' })).toContain('name');
    // rbac-deny no-mutation keys on (denier, marker) — the hrbp create must have inserted nothing.
    const nm = e.readbackNoMutation(er, 'a', 'hrbp');
    expect(nm.params).toEqual(['B', WRITE_CYCLE_MARKER]);
    expect(nm.expect([{ n: 0 }])).toBeNull();
    expect(nm.expect([{ n: 1 }])).toContain('inserted');
  });

  it('open-cycle: draft→open, cross-org IDOR denied via 409, no-mutation leaves from-state', () => {
    const e = ep('open-cycle');
    expect(e.buildParity(er).path).toBe(`/evaluation360/cycles/${WRITE_EVAL_CYCLES.draftA}/open`);
    expect(e.buildIdor!(er).path).toBe(`/evaluation360/cycles/${WRITE_EVAL_CYCLES.draftB}/open`);
    expect(e.idorDeniedStatuses).toEqual([409]);
    expect(e.expectResponse({ cycleId: WRITE_EVAL_CYCLES.draftA, status: 'open' })).toBeNull();
    expect(e.expectResponse({ cycleId: WRITE_EVAL_CYCLES.draftA, status: 'draft' })).toContain('open');
    // IDOR no-mutation: org-B draft cycle still draft.
    const nm = e.readbackNoMutation(er, 'b');
    expect(nm.params).toEqual([WRITE_EVAL_CYCLES.draftB]);
    expect(nm.expect([{ status: 'draft' }])).toBeNull();
    expect(nm.expect([{ status: 'open' }])).toContain('forbidden open');
    // mutated golden: org-A cycle became open.
    expect(e.readbackMutated(er, {}).expect([{ status: 'open' }])).toBeNull();
    expect(e.readbackMutated(er, {}).expect([{ status: 'draft' }])).toContain('did not apply');
  });

  it('close/publish transitions target the open/closed from-state cycles', () => {
    expect(ep('close-cycle').buildParity(er).path).toBe(`/evaluation360/cycles/${WRITE_EVAL_CYCLES.openA}/close`);
    expect(ep('publish-cycle').buildParity(er).path).toBe(`/evaluation360/cycles/${WRITE_EVAL_CYCLES.closedA}/publish`);
    expect(ep('close-cycle').idorDeniedStatuses).toEqual([409]);
    expect(ep('publish-cycle').readbackNoMutation(er, 'b').expect([{ status: 'closed' }])).toBeNull();
  });

  it('assign-raters: valid in-org body, cross-org cycle IDOR denied via 409', () => {
    const e = ep('assign-raters');
    expect(e.buildParity(er)).toEqual({
      path: `/evaluation360/cycles/${WRITE_EVAL_CYCLES.assignA}/raters`,
      body: { assignments: [{ subjectUserId: 'H', raterUserId: 'B', relationship: 'peer' }] },
    });
    expect(e.buildIdor!(er).path).toBe(`/evaluation360/cycles/${WRITE_EVAL_CYCLES.assignB}/raters`);
    expect(e.idorDeniedStatuses).toEqual([409]);
    expect(e.expectResponse({ created: 1 })).toBeNull();
    expect(e.expectResponse({ created: 0 })).toContain('created=1');
    expect(e.readbackMutated(er, {}).expect([{ n: 1 }])).toBeNull();
    expect(e.readbackNoMutation(er, 'b').expect([{ n: 0 }])).toBeNull();
  });

  it('submit-ratings: identity-anchored — 6 competencies, IDOR + non-owner both 404', () => {
    const e = ep('submit-ratings');
    const body = e.buildParity(er).body as { ratings: { competencyKey: string }[] };
    expect(e.buildParity(er).path).toBe('/evaluation360/assignments/asgA/ratings');
    expect(body.ratings).toHaveLength(6);
    expect(body.ratings.map((r) => r.competencyKey).sort()).toEqual([...EVAL360_COMPETENCIES].sort());
    expect(e.buildIdor!(er).path).toBe('/evaluation360/assignments/asgB/ratings');
    expect(e.idorDeniedStatuses).toEqual([404]);
    expect(e.rbacDenyStatus).toBe(404);
    expect(e.expectedByRole).toEqual({ super_admin: 'allow', hr_admin: 'deny', hrbp: 'deny' });
    // mutated golden: submitted + exactly 6 responses.
    expect(e.readbackMutated(er, {}).expect([{ status: 'submitted', n: 6 }])).toBeNull();
    expect(e.readbackMutated(er, {}).expect([{ status: 'submitted', n: 5 }])).toContain('6 rater_responses');
    // no-mutation: still pending, zero forged responses.
    expect(e.readbackNoMutation(er, 'b').expect([{ status: 'pending', n: 0 }])).toBeNull();
    expect(e.readbackNoMutation(er, 'b').expect([{ status: 'pending', n: 1 }])).toContain('forged');
  });
});
