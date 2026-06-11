import { describe, it, expect } from 'vitest';
import { resolveAccess, widestScope } from '../../packages/api/src/access/resolve';
import type { Grant } from '../../packages/api/src/access/types';

// Grant = one rolePermission row projected to {role, module, action, scope}.
const g = (role: string, module: string, action: string, scope: string): Grant =>
  ({ role, module, action, scope }) as Grant;

describe('widestScope', () => {
  it('orders own < team < unit < company < organization', () => {
    expect(widestScope(['own', 'team'])).toBe('team');
    expect(widestScope(['unit', 'own', 'organization'])).toBe('organization');
    expect(widestScope(['company', 'unit'])).toBe('company');
    expect(widestScope(['own'])).toBe('own');
  });
});

describe('resolveAccess', () => {
  it('denies by default when no grant matches module+action', () => {
    expect(
      resolveAccess([g('employee', 'performance', 'read', 'own')], 'compensation', 'read'),
    ).toEqual({ allowed: false });
  });

  it('allows with the grant scope and contributing role', () => {
    expect(
      resolveAccess([g('leader', 'performance', 'read', 'team')], 'performance', 'read'),
    ).toEqual({ allowed: true, scope: 'team', roles: ['leader'] });
  });

  it('stacking = union: widest scope wins, ALL contributing roles carried', () => {
    expect(
      resolveAccess(
        [
          g('employee', 'performance', 'read', 'own'),
          g('leader', 'performance', 'read', 'team'),
        ],
        'performance', 'read',
      ),
    ).toEqual({ allowed: true, scope: 'team', roles: ['employee', 'leader'] });
  });

  it('does not let an unrelated action widen this action', () => {
    expect(
      resolveAccess(
        [
          g('leader', 'vacancy', 'read', 'team'),
          g('leader', 'vacancy', 'approve', 'organization'),
        ],
        'vacancy', 'read',
      ),
    ).toEqual({ allowed: true, scope: 'team', roles: ['leader'] });
  });

  it('dedupes contributing roles', () => {
    const r = resolveAccess(
      [g('leader', 'x', 'read', 'team'), g('leader', 'x', 'read', 'own')],
      'x', 'read',
    );
    expect(r).toEqual({ allowed: true, scope: 'team', roles: ['leader'] });
  });

  it('empty grants = user with no roles → denied', () => {
    expect(resolveAccess([], 'x', 'read')).toEqual({ allowed: false });
  });

  it('malformed scope alone → denied (garbage = no grant, fail-closed)', () => {
    expect(
      resolveAccess([g('hr_admin', 'candidate', 'read', 'all')], 'candidate', 'read'),
    ).toEqual({ allowed: false });
  });

  it('malformed grant in a mix contributes nothing — valid grant wins alone', () => {
    expect(
      resolveAccess(
        [
          g('hr_admin', 'candidate', 'read', 'all'),
          g('recruiter', 'candidate', 'read', 'team'),
        ],
        'candidate', 'read',
      ),
    ).toEqual({ allowed: true, scope: 'team', roles: ['recruiter'] });
  });
});

describe('widestScope (floor)', () => {
  it('empty input floors to own (narrowest scope)', () => {
    expect(widestScope([])).toBe('own');
  });
});
