import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSIGNABLE_STAFF_ROLES, SYSTEM_ROLES, canGrantStaffRole, grantableStaffRoles } from '@tims/shared';

// The staff-role grant policy is enforced on TWO stacks: C# /tenant-invitations (InvitationGrantPolicy) and
// tRPC user.create / user.assignRole (grantableStaffRoles). Both assert the SAME golden matrix
// (contracts/identity-fixtures/invitation-grant-policy.json; the C# side is
// Tims.UnitTests/Identity/InvitationGrantPolicyFixtureTests.cs), so a policy change on either stack alone turns
// that stack's suite red — the drift that let the TS paths skip the policy entirely (PR #307 panel finding).

interface GrantCase {
  name: string;
  callerRoles: string[];
  grantable: string[];
}
interface GrantFixture {
  probeRoles: string[];
  cases: GrantCase[];
}

const data = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../contracts/identity-fixtures/invitation-grant-policy.json', import.meta.url)),
    'utf8',
  ),
) as GrantFixture;

describe('identity-fixtures: invitation-grant-policy.json (TS)', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('grantable: %s', (_name, c) => {
    expect(grantableStaffRoles(c.callerRoles)).toEqual(c.grantable);
  });

  it.each(data.cases.map((c) => [c.name, c] as const))('canGrant agrees for every probe role: %s', (_name, c) => {
    for (const role of data.probeRoles) {
      expect([role, canGrantStaffRole(c.callerRoles, role)]).toEqual([role, c.grantable.includes(role)]);
    }
  });

  it('the matrix covers every system role as a sole caller role, and probes every system role', () => {
    const soleCallers = new Set(data.cases.filter((c) => c.callerRoles.length === 1).map((c) => c.callerRoles[0]));
    for (const role of SYSTEM_ROLES) {
      expect(soleCallers.has(role)).toBe(true);
      expect(data.probeRoles).toContain(role);
    }
    expect(data.cases.some((c) => c.callerRoles.length === 0)).toBe(true);
  });

  it('never grants outside ASSIGNABLE_STAFF_ROLES', () => {
    for (const c of data.cases) {
      for (const role of grantableStaffRoles(c.callerRoles)) expect(ASSIGNABLE_STAFF_ROLES).toContain(role);
    }
  });
});
