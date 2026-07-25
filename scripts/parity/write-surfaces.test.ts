import { describe, it, expect } from 'vitest';
import {
  WRITE_SURFACES,
  WRITE_EVAL_CYCLES,
  WRITE_CYCLE_MARKER,
  WRITE_SUCCESSION_ROLES,
  WRITE_SUCCESSION_CR_MARKER,
  WRITE_ENGAGEMENT,
  WRITE_ENGAGEMENT_SURVEY_MARKER,
  WRITE_ENGAGEMENT_PLAN_MARKER,
  EVAL360_COMPETENCIES,
  type WriteResolved,
  type Evaluation360WriteResolved,
  type SuccessionWriteResolved,
  type EngagementWriteResolved,
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

describe('WRITE_SURFACES succession', () => {
  const s = WRITE_SURFACES['succession'];
  const sr: SuccessionWriteResolved = {
    base: 'http://c',
    userIdByRole: { super_admin: 'S', hr_admin: 'H', hrbp: 'B' },
    subjectA: 'H',
    subjectB: 'bH',
    successorRemoveA: 'remA',
    successorRemoveB: 'remB',
    successorReadinessA: 'rdyA',
    successorReadinessB: 'rdyB',
  };
  const ep = (name: string) => s.endpoints.find((e) => e.name === name)!;

  it('registers the 5 succession writes under the single write flag', () => {
    expect(s.flag).toBe('Platform__SuccessionWriteEnabled');
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'add-critical-role', 'add-successor', 'remove-successor', 'update-successor-readiness', 'update-critical-role-band',
    ]);
    // NO succession write is allow-live (no caller-stamped column) — every endpoint is probe + deny only.
    expect(s.endpoints.every((e) => !e.allowRolesLiveTestable)).toBe(true);
  });

  it('add-critical-role: cross-org holder IDOR denied via 400, keyed on holder', () => {
    const e = ep('add-critical-role');
    expect(e.buildParity(sr).body).toMatchObject({ title: WRITE_SUCCESSION_CR_MARKER, currentHolderId: 'H' });
    expect(e.buildIdor!(sr).body).toMatchObject({ currentHolderId: 'bH' });
    expect(e.idorDeniedStatuses).toEqual([400]);
    // mutated: locate by response id + org-A holder.
    expect(e.readbackMutated(sr, { id: 'new-cr' }).params).toEqual(['new-cr', WRITE_SUCCESSION_CR_MARKER, 'H']);
    // IDOR no-mutation keys on the org-B holder; deny keys on the org-A holder — disjoint.
    expect(e.readbackNoMutation(sr, 'b').params).toEqual([WRITE_SUCCESSION_CR_MARKER, 'bH']);
    expect(e.readbackNoMutation(sr, 'a', 'hrbp').params).toEqual([WRITE_SUCCESSION_CR_MARKER, 'H']);
    expect(e.readbackNoMutation(sr, 'b').expect([{ n: 0 }])).toBeNull();
    expect(e.readbackNoMutation(sr, 'b').expect([{ n: 1 }])).toContain('forbidden');
  });

  it('add-successor: cross-org subject IDOR denied via 403 (H1), deny keys on added_by', () => {
    const e = ep('add-successor');
    expect(e.buildParity(sr).path).toBe(`/succession/critical-roles/${WRITE_SUCCESSION_ROLES.addA}/successors`);
    expect(e.buildParity(sr).body).toMatchObject({ userId: 'H', readiness: 'ready_now', type: 'internal' });
    expect(e.buildIdor!(sr).body).toMatchObject({ userId: 'bH' });
    expect(e.idorDeniedStatuses).toEqual([403]);
    expect(e.readbackNoMutation(sr, 'b').params).toEqual([WRITE_SUCCESSION_ROLES.addA, 'bH']);
    expect(e.readbackNoMutation(sr, 'a', 'hrbp').params).toEqual([WRITE_SUCCESSION_ROLES.addA, 'B']);
    expect(e.readbackMutated(sr, { id: 'new-succ' }).expect([{ id: 'new-succ' }])).toBeNull();
    expect(e.readbackMutated(sr, { id: 'new-succ' }).expect([{ id: 'other' }])).toContain('!=');
  });

  it('remove-successor: DELETE by-id, IDOR 404, no-mutation asserts the row still exists', () => {
    const e = ep('remove-successor');
    expect(e.method).toBe('DELETE');
    expect(e.buildParity(sr)).toEqual({ path: '/succession/successors/remA', body: null });
    expect(e.buildIdor!(sr).path).toBe('/succession/successors/remB');
    expect(e.idorDeniedStatuses).toEqual([404]);
    expect(e.readbackMutated(sr, { id: 'remA' }).expect([{ n: 0 }])).toBeNull(); // deleted
    expect(e.readbackMutated(sr, { id: 'remA' }).expect([{ n: 1 }])).toContain('did not delete');
    expect(e.readbackNoMutation(sr, 'b').expect([{ n: 1 }])).toBeNull(); // org-B row survives
    expect(e.readbackNoMutation(sr, 'b').expect([{ n: 0 }])).toContain('deleted the row');
  });

  it('update-successor-readiness: PATCH by-id, IDOR 404, no-mutation asserts from-state developing', () => {
    const e = ep('update-successor-readiness');
    expect(e.method).toBe('PATCH');
    expect(e.buildParity(sr)).toEqual({ path: '/succession/successors/rdyA/readiness', body: { readiness: 'ready_now' } });
    expect(e.buildIdor!(sr).path).toBe('/succession/successors/rdyB/readiness');
    expect(e.readbackMutated(sr, {}).expect([{ readiness: 'ready_now' }])).toBeNull();
    expect(e.readbackMutated(sr, {}).expect([{ readiness: 'developing' }])).toContain('did not apply');
    expect(e.readbackNoMutation(sr, 'b').expect([{ readiness: 'developing' }])).toBeNull();
    expect(e.readbackNoMutation(sr, 'b').expect([{ readiness: 'ready_now' }])).toContain('mutated readiness');
  });

  it('update-critical-role-band: PATCH by-id, IDOR 404, no-mutation checks org-A NULL / org-B ORGB-BAND', () => {
    const e = ep('update-critical-role-band');
    expect(e.buildParity(sr).path).toBe(`/succession/critical-roles/${WRITE_SUCCESSION_ROLES.bandA}/band`);
    expect(e.buildIdor!(sr).path).toBe(`/succession/critical-roles/${WRITE_SUCCESSION_ROLES.bandB}/band`);
    expect(e.expectResponse({ id: 'x', targetBandLevel: 'PARITY-BAND' })).toBeNull();
    expect(e.expectResponse({ id: 'x', targetBandLevel: 'OTHER' })).toContain('PARITY-BAND');
    expect(e.readbackMutated(sr, {}).expect([{ target_band_level: 'PARITY-BAND' }])).toBeNull();
    // IDOR target org-B must stay at its seeded 'ORGB-BAND'; deny target org-A stays NULL.
    expect(e.readbackNoMutation(sr, 'b').expect([{ target_band_level: 'ORGB-BAND' }])).toBeNull();
    expect(e.readbackNoMutation(sr, 'b').expect([{ target_band_level: 'PARITY-BAND' }])).toContain('mutated');
    expect(e.readbackNoMutation(sr, 'a').expect([{ target_band_level: null }])).toBeNull();
  });
});

describe('WRITE_SURFACES engagement', () => {
  const s = WRITE_SURFACES['engagement'];
  const gr: EngagementWriteResolved = {
    base: 'http://c',
    userIdByRole: { super_admin: 'S', hr_admin: 'H', hrbp: 'B' },
    subjectA: 'H',
    subjectB: 'bH',
  };
  const ep = (name: string) => s.endpoints.find((e) => e.name === name)!;

  it('registers the 5 engagement writes under the single write flag', () => {
    expect(s.flag).toBe('Platform__EngagementWriteEnabled');
    expect(s.endpoints.map((e) => e.name)).toEqual([
      'create-survey', 'activate-survey', 'submit-survey-response', 'create-action-plan', 'update-action-plan',
    ]);
  });

  it('create-survey: NO IDOR target, allow-live via created_by attribution', () => {
    const e = ep('create-survey');
    expect(e.buildIdor).toBeUndefined();
    expect(e.buildParity(gr).body).toMatchObject({ title: WRITE_ENGAGEMENT_SURVEY_MARKER, type: 'pulse' });
    expect(e.allowRolesLiveTestable).toBe(true);
    // mutated keys on the probe's created_by; allow keys on hr_admin's; deny on hrbp's — disjoint.
    expect(e.readbackMutated(gr, { id: 'x' }).params).toEqual(['S', WRITE_ENGAGEMENT_SURVEY_MARKER]);
    expect(e.readbackAllow!(gr, 'hr_admin', { id: 'x' }).params).toEqual(['H', WRITE_ENGAGEMENT_SURVEY_MARKER]);
    expect(e.readbackNoMutation(gr, 'a', 'hrbp').params).toEqual(['B', WRITE_ENGAGEMENT_SURVEY_MARKER]);
    expect(e.readbackNoMutation(gr, 'a', 'hrbp').expect([{ n: 0 }])).toBeNull();
  });

  it('activate-survey: by-id draft→active, cross-org IDOR 404, no-mutation stays draft', () => {
    const e = ep('activate-survey');
    expect(e.buildParity(gr).path).toBe(`/engagement/surveys/${WRITE_ENGAGEMENT.activateSurveyA}/activate`);
    expect(e.buildIdor!(gr).path).toBe(`/engagement/surveys/${WRITE_ENGAGEMENT.activateSurveyB}/activate`);
    expect(e.idorDeniedStatuses).toEqual([404]);
    expect(e.readbackMutated(gr, {}).expect([{ status: 'active' }])).toBeNull();
    expect(e.readbackMutated(gr, {}).expect([{ status: 'draft' }])).toContain('did not apply');
    expect(e.readbackNoMutation(gr, 'b').expect([{ status: 'draft' }])).toBeNull();
    expect(e.readbackNoMutation(gr, 'b').expect([{ status: 'active' }])).toContain('mutated');
  });

  it('submit-survey-response: identity, allow-live via user_id, cross-org 404', () => {
    const e = ep('submit-survey-response');
    expect(e.buildParity(gr).path).toBe(`/engagement/surveys/${WRITE_ENGAGEMENT.submitSurveyA}/responses`);
    expect(e.buildParity(gr).body).toEqual({ answers: { q1: 'yes' } });
    expect(e.idorDeniedStatuses).toEqual([404]);
    expect(e.allowRolesLiveTestable).toBe(true);
    expect(e.readbackMutated(gr, { id: 'r1' }).params).toEqual([WRITE_ENGAGEMENT.submitSurveyA, 'S']);
    expect(e.readbackAllow!(gr, 'hr_admin', {}).params).toEqual([WRITE_ENGAGEMENT.submitSurveyA, 'H']);
    // IDOR keys on org-B survey + probe; deny keys on org-A survey + denier.
    expect(e.readbackNoMutation(gr, 'b').params).toEqual([WRITE_ENGAGEMENT.submitSurveyB, 'S']);
    expect(e.readbackNoMutation(gr, 'a', 'hrbp').params).toEqual([WRITE_ENGAGEMENT.submitSurveyA, 'B']);
  });

  it('create-action-plan: cross-org responsibleId IDOR 403 (H1), NOT allow-live', () => {
    const e = ep('create-action-plan');
    expect(e.buildParity(gr).body).toMatchObject({ title: WRITE_ENGAGEMENT_PLAN_MARKER, responsibleId: 'H' });
    expect(e.buildIdor!(gr).body).toMatchObject({ responsibleId: 'bH' });
    expect(e.idorDeniedStatuses).toEqual([403]);
    expect(e.allowRolesLiveTestable).toBeFalsy();
    expect(e.readbackNoMutation(gr, 'b').params).toEqual([WRITE_ENGAGEMENT_PLAN_MARKER, 'bH']);
    expect(e.readbackNoMutation(gr, 'a', 'hrbp').params).toEqual([WRITE_ENGAGEMENT_PLAN_MARKER, 'H']);
    expect(e.readbackNoMutation(gr, 'b').expect([{ n: 0 }])).toBeNull();
    expect(e.readbackNoMutation(gr, 'b').expect([{ n: 1 }])).toContain('forbidden');
  });

  it('update-action-plan: by-id PATCH, cross-org IDOR 404, no-mutation stays pending', () => {
    const e = ep('update-action-plan');
    expect(e.buildParity(gr)).toEqual({ path: `/engagement/action-plans/${WRITE_ENGAGEMENT.actionPlanA}`, body: { status: 'in_progress' } });
    expect(e.buildIdor!(gr).path).toBe(`/engagement/action-plans/${WRITE_ENGAGEMENT.actionPlanB}`);
    expect(e.idorDeniedStatuses).toEqual([404]);
    expect(e.readbackMutated(gr, {}).expect([{ status: 'in_progress' }])).toBeNull();
    expect(e.readbackNoMutation(gr, 'b').expect([{ status: 'pending' }])).toBeNull();
    expect(e.readbackNoMutation(gr, 'b').expect([{ status: 'in_progress' }])).toContain('mutated');
  });
});
