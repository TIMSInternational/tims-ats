import { describe, it, expect } from 'vitest';
import { PATH_MODULE, moduleForPath } from '../../apps/web/lib/nav/routes';

describe('route→module map', () => {
  it('exact match returns the module', () => {
    expect(moduleForPath('/recruitment/candidates')).toBe('candidate');
  });
  it('child path matches by longest prefix', () => {
    expect(moduleForPath('/recruitment/candidates/abc-123')).toBe('candidate');
  });
  it('null-module routes return null (always allowed)', () => {
    expect(moduleForPath('/dashboard')).toBe(null);
  });
  it('unmapped route returns undefined (treated as allowed)', () => {
    expect(moduleForPath('/nope/nowhere')).toBeUndefined();
  });
  it('PATH_MODULE still covers the known admin routes', () => {
    expect(PATH_MODULE['/talent/team-intelligence']).toBe('team_intel');
  });
  it('longer entry wins over a shorter prefix match (billing over /settings)', () => {
    expect(moduleForPath('/settings/billing')).toBe('billing');
  });
});
