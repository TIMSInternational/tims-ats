import { describe, it, expect } from 'vitest';
import { planSeed, isParityTestEmail, type SeedResources } from './seed';
import { SURFACES } from './surfaces';

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

describe('SeedResources covers every idScopeKey the read registry uses', () => {
  /**
   * `cli.ts`'s `pairFor` looks a by-id endpoint's `idScopeKey` up in the resolved `SeedResources` bag
   * with a `keyof SeedResources` cast, and THROWS at run time — mid-`verify`, against live prod —
   * when the key is absent. Nothing checked the two agreed.
   *
   * This object is exhaustive BY TYPE: `Record<keyof SeedResources, true>` fails `tsc` if a key is
   * added to the interface and not listed here, or listed here and not in the interface. The loop
   * below then closes the other direction at run time.
   *
   * HALF OF THIS GUARD IS COMPILE-TIME ONLY, and that is worth stating rather than discovering.
   * Deleting a key from `SeedResources` is caught by `tsc --noEmit` (two errors: here, and at
   * `resolveResources`'s return literal) — NOT by vitest, which does not type-check. Both run in the
   * gate, so the guard holds; but do not read a green vitest as having exercised it. The runtime half
   * (the loop below) is what catches the other direction: a registry endpoint naming a key that does
   * not exist. `resolveResources` itself cannot be unit-tested — it needs a live seeded DB.
   */
  const SEED_RESOURCE_KEYS: Record<keyof SeedResources, true> = {
    employee: true,
    'eval-cycle-staff': true,
    'eval-cycle-self': true,
    calibration: true,
    'critical-role': true,
    // #195, 2026-08-11 — threaded into SURFACES['organization'].detail.
    organization: true,
  };

  it('every by-id endpoint names a resource key resolveResources actually returns', () => {
    let seen = 0;
    for (const [surfaceKey, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (!ep.idScopeKey) continue;
        seen++;
        expect(
          Object.prototype.hasOwnProperty.call(SEED_RESOURCE_KEYS, ep.idScopeKey),
          `${surfaceKey}/${ep.name}: idScopeKey "${ep.idScopeKey}" is not a SeedResources key — cli.ts's pairFor would throw mid-verify`,
        ).toBe(true);
      }
    }
    // Non-vacuity: three by-id endpoints today (compensation/employee, ninebox/axis-breakdown,
    // organization/detail — the same set surfaces.test.ts pins). If this loop goes empty the
    // assertion above stops being a guard while still reading as one.
    expect(seen).toBe(3);
  });
});
