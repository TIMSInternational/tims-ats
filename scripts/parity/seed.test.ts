import { describe, it, expect } from 'vitest';
import { planSeed, isParityTestEmail } from './seed';

describe('planSeed', () => {
  it('produces 2 orgs and a user per configured role, deterministic emails', () => {
    const plan = planSeed(['org_admin', 'manager']);
    expect(plan.orgs).toEqual(['__parity_a', '__parity_b']);
    expect(plan.users).toHaveLength(4); // 2 orgs x 2 roles
    expect(plan.users.map((u) => u.email)).toContain('parity+a-org_admin@tims.test');
    expect(new Set(plan.users.map((u) => u.email)).size).toBe(4); // unique
  });
});

describe('isParityTestEmail', () => {
  it('matches deterministic seeded parity emails for both orgs', () => {
    expect(isParityTestEmail('parity+a-org_admin@tims.test')).toBe(true);
    expect(isParityTestEmail('parity+b-manager@tims.test')).toBe(true);
  });

  it('rejects non-parity, wrong-org, wrong-domain, and empty emails', () => {
    expect(isParityTestEmail('someone@tims.test')).toBe(false);
    expect(isParityTestEmail('parity+c-x@tims.test')).toBe(false);
    expect(isParityTestEmail('parity+a-x@example.com')).toBe(false);
    expect(isParityTestEmail('')).toBe(false);
  });
});
