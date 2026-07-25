import { describe, it, expect } from 'vitest';
import { WRITE_SURFACES, type WriteResolved } from './write-surfaces';

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
    expect(ep.buildIdor(res).body).toMatchObject({ userId: 'subjB' });
    expect(ep.expectedByRole).toEqual({ super_admin: 200, hr_admin: 200, hrbp: 403 });
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
    expect(ep.buildIdor(res).path).toBe('/compensation/adjustments/resB/approve');
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
