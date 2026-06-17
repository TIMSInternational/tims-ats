import { describe, it, expect } from 'vitest';
import { pickPrimaryDashboard } from '../../apps/web/app/(admin)/dashboard/pick-dashboard';

describe('pickPrimaryDashboard', () => {
  it('super_admin → org command center', () => {
    expect(pickPrimaryDashboard(['super_admin'])).toBe('org');
    expect(pickPrimaryDashboard(['super_admin', 'recruiter'])).toBe('org'); // super_admin wins
  });
  it('hr_admin → hrExec; hrbp → unit; recruiter → recruiter (each its own landing)', () => {
    expect(pickPrimaryDashboard(['hr_admin'])).toBe('hrExec');
    expect(pickPrimaryDashboard(['hrbp'])).toBe('unit');
    expect(pickPrimaryDashboard(['recruiter'])).toBe('recruiter');
  });
  it('admin-tier precedence: hr_admin > hrbp > recruiter on collisions', () => {
    expect(pickPrimaryDashboard(['hrbp', 'recruiter'])).toBe('unit');
    expect(pickPrimaryDashboard(['hr_admin', 'recruiter'])).toBe('hrExec');
    expect(pickPrimaryDashboard(['hr_admin', 'hrbp'])).toBe('hrExec');
  });
  it('leader → manager dashboard (NEW); committee stays on leader dashboard (Slice 4 gives it My Tasks)', () => {
    expect(pickPrimaryDashboard(['leader'])).toBe('manager');
    expect(pickPrimaryDashboard(['leader', 'committee'])).toBe('manager'); // leader wins
    expect(pickPrimaryDashboard(['committee'])).toBe('leader');
  });
  it('admin-tier still outranks leader', () => {
    expect(pickPrimaryDashboard(['leader', 'recruiter'])).toBe('recruiter');
  });
  it('admin-tier outranks committee in a multi-role collision', () => {
    expect(pickPrimaryDashboard(['committee', 'hr_admin'])).toBe('hrExec');
  });
  it('employee (or unknown) → employee dashboard', () => {
    expect(pickPrimaryDashboard(['employee'])).toBe('employee');
    expect(pickPrimaryDashboard([])).toBe('employee');
  });
});
