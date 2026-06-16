import { describe, it, expect } from 'vitest';
import { pickPrimaryDashboard } from '../../apps/web/app/(admin)/dashboard/pick-dashboard';

describe('pickPrimaryDashboard', () => {
  it('super_admin → org command center', () => {
    expect(pickPrimaryDashboard(['super_admin'])).toBe('org');
    expect(pickPrimaryDashboard(['super_admin', 'recruiter'])).toBe('org'); // super_admin wins
  });
  it('hr_admin / recruiter / hrbp → recruiter dashboard', () => {
    expect(pickPrimaryDashboard(['hr_admin'])).toBe('recruiter');
    expect(pickPrimaryDashboard(['recruiter'])).toBe('recruiter');
    expect(pickPrimaryDashboard(['hrbp'])).toBe('recruiter');
  });
  it('leader → leader dashboard', () => {
    expect(pickPrimaryDashboard(['leader'])).toBe('leader');
  });
  it('committee stays on leader dashboard for now (Slice 4 gives it My Tasks)', () => {
    expect(pickPrimaryDashboard(['committee'])).toBe('leader');
  });
  it('recruiter-tier outranks leader-tier in a multi-role collision', () => {
    expect(pickPrimaryDashboard(['leader', 'recruiter'])).toBe('recruiter');
    expect(pickPrimaryDashboard(['committee', 'hr_admin'])).toBe('recruiter');
  });
  it('employee (or unknown) → employee dashboard', () => {
    expect(pickPrimaryDashboard(['employee'])).toBe('employee');
    expect(pickPrimaryDashboard([])).toBe('employee');
  });
});
