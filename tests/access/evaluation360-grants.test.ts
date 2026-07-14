import { describe, it, expect } from 'vitest';
import { MODULES } from '@tims/shared';
import { MATRIX, grantsFor } from '../../packages/db/prisma/seed-access-matrix';

const has = (role: string, module: string, action: string, scope: string) =>
  grantsFor(role).some((g) => g.module === module && g.action === action && g.scope === scope);

describe('evaluation360 RBAC module', () => {
  it('MODULES includes evaluation360', () => {
    expect(MODULES).toContain('evaluation360');
  });

  it('super_admin has full org-scoped evaluation360 grants', () => {
    for (const action of ['read', 'create', 'update', 'delete'])
      expect(has('super_admin', 'evaluation360', action, 'organization'), `super_admin ${action}`).toBe(true);
  });

  it('hr_admin has full org-scoped evaluation360 grants', () => {
    for (const action of ['read', 'create', 'update', 'delete'])
      expect(has('hr_admin', 'evaluation360', action, 'organization'), `hr_admin ${action}`).toBe(true);
  });

  // Fix wave (CRITICAL scope-escalation fix): the evaluation360 admin
  // procedures (createCycle/openCycle/closeCycle/publishCycle/assignRaters/
  // listCycles/getCycleProgress) are org-only (requireOrgScope in the
  // router). A unit/team-scoped read grant on hrbp/leader would therefore be
  // dead/misleading — those roles no longer get an evaluation360 grant at
  // all. Scoped unit/team monitoring is deferred to a later slice.
  it('hrbp has NO evaluation360 grant (admin endpoints are org-only; scoped monitoring deferred)', () => {
    expect(grantsFor('hrbp').some((g) => g.module === 'evaluation360')).toBe(false);
  });

  it('leader has NO evaluation360 grant (admin endpoints are org-only; scoped monitoring deferred)', () => {
    expect(grantsFor('leader').some((g) => g.module === 'evaluation360')).toBe(false);
  });

  // Fix wave (Important — RBAC over-restriction): self-service
  // (myRaterTasks/submitRatings/myReport/myReportCycles) is now
  // protectedProcedure, identity-anchored on raterUserId/subjectUserId ===
  // ctx.user.id, NOT RBAC-gated — so employee (and every other staff role)
  // needs no evaluation360 grant at all to use it.
  it('employee has NO evaluation360 grant (self-service is identity-authorized via protectedProcedure, not RBAC)', () => {
    expect(grantsFor('employee').some((g) => g.module === 'evaluation360')).toBe(false);
  });

  it('recruiter, committee, external are NOT granted evaluation360', () => {
    for (const role of ['recruiter', 'committee', 'external'])
      expect(grantsFor(role).some((g) => g.module === 'evaluation360'), `${role} must not have evaluation360`).toBe(false);
  });

  it('no role other than super_admin/hr_admin is granted evaluation360', () => {
    for (const role of Object.keys(MATRIX)) {
      if (role === 'super_admin' || role === 'hr_admin') continue;
      expect(grantsFor(role).some((g) => g.module === 'evaluation360'), `${role} must not have evaluation360`).toBe(false);
    }
  });

  it('MATRIX super_admin and hr_admin evaluation360 grants exist', () => {
    expect(MATRIX.super_admin.some((e) => e.module === 'evaluation360')).toBe(true);
    expect(MATRIX.hr_admin.some((e) => e.module === 'evaluation360')).toBe(true);
  });
});
