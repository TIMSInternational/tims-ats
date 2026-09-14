import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isMfaEnforced, isMfaGateBlocking, isMfaPrivileged, MFA_REQUIRED } from '@tims/shared';

/**
 * #173 — the MFA step-up gate, pinned to the goldens the C# port also asserts
 * (contracts/mfa-fixtures/cases.json ↔ Tims.UnitTests/Identity/MfaGateFixtureTests.cs).
 *
 * These exercise the REAL `packages/shared/src/mfa.ts` exports that `trpc.ts`'s
 * `withMfaEnforcement` and the (admin) layout both call — not a copy. Until #173 the C# stack had
 * no implementation at all, so a privileged `aal1` token was refused by tRPC and served a 200 by
 * the platform service. One JSON, two stacks: a divergence about WHO must step up, or WHEN, turns
 * that side's CI red.
 *
 * The two asymmetric directions are the reason this is fixtured rather than eyeballed:
 * the FLAG fails OPEN (a garbled env must never lock privileged operators out) while the LEVEL
 * fails CLOSED (once on, an unknown level is never good enough). Getting either backwards is a
 * production incident in one direction and a silent hole in the other.
 */

interface BlockingCase {
  name: string;
  input: { enforced: boolean; isPrivileged: boolean; currentLevel: string | null };
  expected: boolean;
}
interface FlagCase {
  name: string;
  input: string | null;
  expected: boolean;
}
interface PrivilegedCase {
  name: string;
  roles: string[];
  isPlatformOwner: boolean;
  expected: boolean;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'mfa-fixtures', 'cases.json'), 'utf8'),
) as {
  cases: BlockingCase[];
  enforcedFlag: FlagCase[];
  privileged: PrivilegedCase[];
};

describe('MFA gate — cross-stack goldens', () => {
  it('every section has cases (floor guard — the loops below are quantifiers)', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
    expect(fixture.enforcedFlag.length).toBeGreaterThanOrEqual(5);
    expect(fixture.privileged.length).toBeGreaterThanOrEqual(5);
  });

  for (const c of fixture.cases) {
    it(`isMfaGateBlocking: ${c.name}`, () => {
      expect(
        isMfaGateBlocking({
          enforced: c.input.enforced,
          isPrivileged: c.input.isPrivileged,
          currentLevel: c.input.currentLevel,
        }),
      ).toBe(c.expected);
    });
  }

  for (const c of fixture.enforcedFlag) {
    it(`isMfaEnforced: ${c.name}`, () => {
      expect(isMfaEnforced(c.input ?? undefined)).toBe(c.expected);
    });
  }

  for (const c of fixture.privileged) {
    it(`isMfaPrivileged: ${c.name}`, () => {
      expect(isMfaPrivileged({ roles: c.roles, isPlatformOwner: c.isPlatformOwner })).toBe(c.expected);
    });
  }

  it('the sentinel is the exact string the web client redirects on', () => {
    // trpc-provider.tsx compares err.message === MFA_REQUIRED. The C# middleware returns it as the
    // 403 body's `message`, which client.ts lifts into PlatformApiError.message — so this one string
    // is what makes the platform-api path recoverable rather than a dead end.
    expect(MFA_REQUIRED).toBe('MFA_REQUIRED');
  });
});
