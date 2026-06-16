import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const org = () => readFileSync(join(ROOT, 'packages/api/src/routers/organization.ts'), 'utf8');
// The grant MATRIX was extracted into a pure, importable module (seed-access-matrix.ts);
// the seed runner (seed-access.ts) now imports it. These text-based tripwires assert on
// the MATRIX source of truth, so they read the matrix module.
const seed = () => readFileSync(join(ROOT, 'packages/db/prisma/seed-access-matrix.ts'), 'utf8');

describe('hrbp unit-assignment endpoints', () => {
  it('assignUserToUnit is gated by user:create', () => {
    expect(org()).toMatch(/assignUserToUnit:\s*permissionProcedure\('user',\s*'create'\)/);
  });
  it('unassignUserFromUnit is gated by user:delete', () => {
    expect(org()).toMatch(/unassignUserFromUnit:\s*permissionProcedure\('user',\s*'delete'\)/);
  });
  it('listUnitMembers is gated by user:read', () => {
    expect(org()).toMatch(/listUnitMembers:\s*permissionProcedure\('user',\s*'read'\)/);
  });
  it('assign verifies BOTH the businessUnit AND the user belong to the org (IDOR guard)', () => {
    const s = org();
    expect(s).toMatch(/businessUnit\.findFirst/);
    expect(s).toMatch(/user\.findFirst/);
  });
  it('assign maps the @@unique duplicate to CONFLICT (no raw P2002)', () => {
    expect(org()).toMatch(/P2002|code:\s*'CONFLICT'/);
  });

  // Escalation safety: unit assignment writes the UserBusinessUnit anchor that
  // widens unit-scope. It is safe WITHOUT a requireOrgScope gate ONLY because
  // the permission grant itself is org-scope: `user:create`/`user:delete` is
  // granted to hr_admin + super_admin both at scope 'organization'. No role
  // holds the user module at a narrower (team/unit) scope, so no narrow caller
  // can ever reach these endpoints. This tripwire fails if the seed ever grants
  // user:* at a non-org scope (which would reopen the escalation).
  it('seed never grants user:create/delete at a non-org scope', () => {
    const s = seed();
    // Belt-and-suspenders: no user module grant may appear with team/unit/own/company scope.
    expect(s).not.toMatch(/module:\s*'user'[^}]*scope:\s*'(team|unit|own|company)'/);
    // Also verify no '.map(...)' list that includes 'user' sets a narrow scope.
    const narrowUserLines = s
      .split('\n')
      .filter((l) => /'user'/.test(l) && /scope:\s*'(team|unit|own|company)'/.test(l));
    expect(narrowUserLines).toHaveLength(0);
  });

  // Positive regression: hr_admin must hold the EXACT grant that unit-assignment
  // now requires (user:read/create/update/delete @ organization). This test fails
  // loudly if a future seed change removes hr_admin's user grant, preventing a
  // silent regression where the fix lands but hr_admin silently loses access.
  it('seed grants hr_admin the user module at organization scope (read/create/update/delete)', () => {
    const s = seed();
    // The hr_admin block's .map() list must include 'user'.
    // Pattern: the CRUD `.map(...)` block in the hr_admin array where scope is 'organization'.
    // We locate the hr_admin section and confirm 'user' appears in it before the
    // closing of the array (hrbp opens next).
    const hrAdminStart = s.indexOf("hr_admin: [");
    const hrbpStart = s.indexOf("hrbp: [");
    expect(hrAdminStart).toBeGreaterThan(-1);
    expect(hrbpStart).toBeGreaterThan(hrAdminStart);
    const hrAdminBlock = s.slice(hrAdminStart, hrbpStart);
    // The CRUD map line includes 'user' in the array
    expect(hrAdminBlock).toMatch(/'user'/);
    // And the scope for that map call is 'organization'
    expect(hrAdminBlock).toMatch(/scope:\s*'organization'/);
  });
});
