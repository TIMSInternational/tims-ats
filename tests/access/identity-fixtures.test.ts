import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Phase 2 Slice 1: the identity-plane parity fixtures (contracts/identity-fixtures/*.json),
// asserted here against the REAL TS resolvers and identically by Tims.UnitTests. A behavior
// change edits the JSON once; either stack disagreeing turns its CI red.

// staff-context.ts verifies the impersonation cookie via @tims/api and reads the DB via an
// injected StaffDbLookup — mock the cookie crypto so the fixture's target drives the branch.
const verifyImpersonationToken = vi.fn();
const readImpersonationCookie = vi.fn();
vi.mock('@tims/api', () => ({
  verifyImpersonationToken: (...a: unknown[]) => verifyImpersonationToken(...a),
  readImpersonationCookie: (...a: unknown[]) => readImpersonationCookie(...a),
  IMPERSONATION_COOKIE: 'tims_impersonation',
}));

import { resolveStaffContext, NEEDS_FALLBACK, type StaffAppUser } from '../../apps/web/lib/auth/staff-context';
import { filterStaffRoleSlugs } from '@tims/shared';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../contracts/identity-fixtures/${name}`, import.meta.url)), 'utf8'));

interface AppUserDto {
  id: string; supabaseUserId: string; email: string; organizationId: string | null;
  isActive: boolean; isPlatformOwner: boolean; roleSlugs: string[];
}

const toStaffAppUser = (d: AppUserDto): StaffAppUser => ({
  id: d.id,
  supabaseUserId: d.supabaseUserId,
  email: d.email,
  organizationId: d.organizationId,
  isActive: d.isActive,
  isPlatformOwner: d.isPlatformOwner,
  lastLoginAt: null,
  userRoles: d.roleSlugs.map((slug) => ({ role: { slug } })),
});

beforeEach(() => vi.clearAllMocks());

// --- filter-staff-roles ---------------------------------------------------------------
describe('identity-fixtures: filter-staff-roles.json', () => {
  const data = fixture('filter-staff-roles.json') as { cases: Array<{ name: string; slugs: string[]; expected: string[] }> };
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(filterStaffRoleSlugs(c.slugs)).toEqual(c.expected);
  });
});

// --- staff-context (the tRPC auth hot path) -------------------------------------------
describe('identity-fixtures: staff-context.json', () => {
  interface ExpectedCtx {
    resolved: boolean; principalType?: string; organizationId?: string; userId?: string;
    roles?: string[]; impersonatedBy?: string | null;
  }
  const data = fixture('staff-context.json') as {
    cases: Array<{ name: string; appUser: AppUserDto | null; target: AppUserDto | null; expected: ExpectedCtx }>;
  };

  it.each(data.cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const db = {
      findUserBySupabaseId: vi.fn().mockResolvedValue(c.appUser ? toStaffAppUser(c.appUser) : null),
      findUserById: vi.fn().mockResolvedValue(c.target ? toStaffAppUser(c.target) : null),
      updateLastLogin: vi.fn(),
    };
    readImpersonationCookie.mockReturnValue(c.target ? 'tok' : null);
    verifyImpersonationToken.mockReturnValue(c.target ? { targetUserId: c.target.id } : null);

    const result = await resolveStaffContext('uid', 'e@x', c.target ? 'cookie' : null, new Headers(), db);

    if (!c.expected.resolved) {
      expect(result).toBe(NEEDS_FALLBACK);
      return;
    }
    expect(result).not.toBe(NEEDS_FALLBACK);
    const user = (result as Exclude<typeof result, typeof NEEDS_FALLBACK>).user;
    // TS carries no PrincipalType — derive it the same way the C# port does.
    const principalType = user.isPlatformOwner ? 'PlatformOwner' : 'OrgUser';
    expect(principalType).toBe(c.expected.principalType);
    expect(user.organizationId).toBe(c.expected.organizationId);
    expect(user.id).toBe(c.expected.userId);
    expect(user.roles).toEqual(c.expected.roles);
    expect(user.impersonatorId ?? null).toEqual(c.expected.impersonatedBy ?? null);
  });
});
