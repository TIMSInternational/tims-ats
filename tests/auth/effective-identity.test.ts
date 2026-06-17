import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveIdentity,
  type IdentityInput,
} from '../../apps/web/lib/auth/effective-identity';

// A "real" platform owner operator.
const owner: IdentityInput = {
  id: 'owner-1',
  firstName: 'Olivia',
  lastName: 'Owner',
  email: 'owner@nexadev.ai',
  avatar: null,
  isPlatformOwner: true,
  organizationId: null,
  roleSlugs: [],
};

// A real org staff user (no impersonation).
const staff: IdentityInput = {
  id: 'staff-1',
  firstName: 'Sam',
  lastName: 'Staff',
  email: 'sam@tims.co',
  avatar: 'https://cdn/sam.png',
  isPlatformOwner: false,
  organizationId: 'org-1',
  roleSlugs: ['recruiter', 'employee'],
};

// An impersonation target — note the mixed-in non-staff `candidate` slug that
// filterStaffRoleSlugs must strip (parity with the tRPC builder).
const target: IdentityInput = {
  id: 'target-1',
  firstName: 'Emma',
  lastName: 'Employee',
  email: 'employee@tims.co',
  avatar: 'https://cdn/emma.png',
  isPlatformOwner: false,
  organizationId: 'org-2',
  roleSlugs: ['employee', 'candidate'],
};

describe('resolveEffectiveIdentity', () => {
  it('not impersonating: preserves the real platform owner (isPlatformOwner stays true)', () => {
    const eff = resolveEffectiveIdentity(owner, null);
    expect(eff.userId).toBe('owner-1');
    expect(eff.isPlatformOwner).toBe(true);
    expect(eff.isImpersonating).toBe(false);
    expect(eff.organizationId).toBeNull();
    expect(eff.email).toBe('owner@nexadev.ai');
  });

  it('not impersonating: preserves a real org staff user and its roles', () => {
    const eff = resolveEffectiveIdentity(staff, null);
    expect(eff.userId).toBe('staff-1');
    expect(eff.isPlatformOwner).toBe(false);
    expect(eff.isImpersonating).toBe(false);
    expect(eff.organizationId).toBe('org-1');
    expect(eff.roleSlugs).toEqual(['recruiter', 'employee']);
  });

  it('impersonating: effective identity becomes the target (isPlatformOwner false, target org + roles)', () => {
    const eff = resolveEffectiveIdentity(owner, target);
    expect(eff.userId).toBe('target-1');
    expect(eff.isPlatformOwner).toBe(false);
    expect(eff.isImpersonating).toBe(true);
    expect(eff.organizationId).toBe('org-2');
    expect(eff.email).toBe('employee@tims.co');
    expect(eff.avatar).toBe('https://cdn/emma.png');
  });

  it('staff-role filter is applied to the target (drops non-staff slugs like candidate)', () => {
    const eff = resolveEffectiveIdentity(owner, target);
    expect(eff.roleSlugs).toEqual(['employee']);
    expect(eff.roleSlugs).not.toContain('candidate');
  });

  it('staff-role filter is applied to the real user too when not impersonating', () => {
    const dirty: IdentityInput = { ...staff, roleSlugs: ['recruiter', 'external', 'employee'] };
    const eff = resolveEffectiveIdentity(dirty, null);
    expect(eff.roleSlugs).toEqual(['recruiter', 'employee']);
  });

  it('displayName is "First Last" and initials are the uppercased first letters', () => {
    expect(resolveEffectiveIdentity(staff, null).displayName).toBe('Sam Staff');
    expect(resolveEffectiveIdentity(staff, null).initials).toBe('SS');
    expect(resolveEffectiveIdentity(owner, target).displayName).toBe('Emma Employee');
    expect(resolveEffectiveIdentity(owner, target).initials).toBe('EE');
  });
});
