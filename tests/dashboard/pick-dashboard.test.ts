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
  it('leader → manager dashboard', () => {
    expect(pickPrimaryDashboard(['leader'])).toBe('manager');
  });
  it('committee → committee (My Tasks); employee → employee (My Home)', () => {
    expect(pickPrimaryDashboard(['committee'])).toBe('committee');
    expect(pickPrimaryDashboard(['employee'])).toBe('employee');
  });
  it('admin-tier still outranks participants', () => {
    expect(pickPrimaryDashboard(['committee', 'recruiter'])).toBe('recruiter');
    expect(pickPrimaryDashboard(['leader', 'committee'])).toBe('manager');
  });
  it('admin-tier still outranks leader', () => {
    expect(pickPrimaryDashboard(['leader', 'recruiter'])).toBe('recruiter');
  });
  it('admin-tier outranks committee in a multi-role collision', () => {
    expect(pickPrimaryDashboard(['committee', 'hr_admin'])).toBe('hrExec');
  });
  it('unknown / empty roles → employee dashboard', () => {
    expect(pickPrimaryDashboard([])).toBe('employee');
    expect(pickPrimaryDashboard(['some_unmapped_role'])).toBe('employee');
  });
});
