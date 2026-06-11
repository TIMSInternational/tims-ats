import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null), cacheSet: vi.fn(),
}));
vi.mock('@tims/db', () => ({ db: { rolePermission: { findMany: vi.fn() } } }));
import { buildAccessForUser } from '../../packages/api/src/access/build';
import { db } from '@tims/db';

const HR = { id: 'u', organizationId: 'o', roles: ['hr_admin'], isPlatformOwner: false };
beforeEach(() => vi.mocked(db.rolePermission.findMany).mockResolvedValue([] as never));

// The deleted HR_ADMIN_MODULES allowlist used to grant these implicitly. After
// Wave 2.5 they require seeded rolePermission rows — and seed-access.ts
// deliberately omits them (docs/WAVE-2.5-ACCESS-CONTROL.md: intentional removals).
// These pin the middleware, not seed-access.ts — a seed re-grant will not fail this file.
describe('hr_admin intentional removals (no seeded rows → denied)', () => {
  for (const [module, action] of [
    ['audit', 'read'], ['audit', 'export'],
    ['feature_flags', 'read'], ['feature_flags', 'update'],
    ['organization', 'update'], ['organization', 'create'], ['organization', 'delete'],
  ] as const) {
    it(`${module}:${action} → denied`, async () => {
      expect(await buildAccessForUser(HR, module, action)).toEqual({ allowed: false });
    });
  }
});
