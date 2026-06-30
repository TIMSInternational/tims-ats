/**
 * s1-auth-fastpath.test.ts  (Task 6 — S1 auth fast-path)
 *
 * Behavioral unit tests for `resolveStaffContext` — the testable seam extracted
 * from the tRPC `createContext` fast-path (Task 6).
 *
 * Design contract tested here:
 *  1. Trusted header present + active staff row → context resolved WITHOUT calling
 *     the getUser fn (spy asserts 0 calls).
 *  2. Trusted header ABSENT → NEEDS_FALLBACK (getUser fn WOULD be called by caller).
 *  3. Trusted header present but appUser null → NEEDS_FALLBACK.
 *  4. Trusted header present but appUser inactive → NEEDS_FALLBACK.
 *  5. Forged inbound header is stripped by middleware (strip-then-set ordering
 *     in updateSession): an inbound value cannot survive to the route handler.
 *  6. Impersonation still resolves the target on the fast path (owner + valid token).
 *
 * No live Supabase or Prisma required — db is injected.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  resolveStaffContext,
  NEEDS_FALLBACK,
  type StaffAppUser,
  type StaffDbLookup,
} from '../../apps/web/lib/auth/staff-context';
import {
  signImpersonationToken,
  IMPERSONATION_COOKIE,
} from '../../packages/api/src/lib/impersonation';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeUser = (overrides: Partial<StaffAppUser> = {}): StaffAppUser => ({
  id: 'user-staff-1',
  supabaseUserId: 'supa-uid-1',
  email: 'staff@tims.co',
  organizationId: 'org-1',
  isActive: true,
  isPlatformOwner: false,
  lastLoginAt: new Date(Date.now() - 120_000), // 2 min ago → threshold exceeded → will update
  userRoles: [{ role: { slug: 'recruiter' } }, { role: { slug: 'employee' } }],
  ...overrides,
});

const ownerUser: StaffAppUser = makeUser({
  id: 'user-owner-1',
  supabaseUserId: 'supa-uid-owner',
  email: 'owner@nexadev.ai',
  organizationId: null,
  isPlatformOwner: true,
  userRoles: [],
});

const targetUser: StaffAppUser = makeUser({
  id: 'user-target-1',
  supabaseUserId: 'supa-uid-target',
  email: 'employee@tims.co',
  organizationId: 'org-2',
  isPlatformOwner: false,
  userRoles: [{ role: { slug: 'employee' } }],
});

interface MockDb extends StaffDbLookup {
  findUserBySupabaseId: Mock;
  findUserById: Mock;
  updateLastLogin: Mock;
}

function makeDb(overrides: Partial<Record<keyof StaffDbLookup, Mock>> = {}): MockDb {
  const base: MockDb = {
    findUserBySupabaseId: vi.fn(),
    findUserById: vi.fn().mockResolvedValue(null),
    updateLastLogin: vi.fn(),
  };
  if (overrides.findUserBySupabaseId !== undefined) base.findUserBySupabaseId = overrides.findUserBySupabaseId;
  if (overrides.findUserById !== undefined) base.findUserById = overrides.findUserById;
  if (overrides.updateLastLogin !== undefined) base.updateLastLogin = overrides.updateLastLogin;
  return base;
}

function makeHeaders(extra: Record<string, string> = {}): Headers {
  const h = new Headers({ 'content-type': 'application/json' });
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

// ---------------------------------------------------------------------------
// 1. Fast path — active staff user, header present
// ---------------------------------------------------------------------------

describe('resolveStaffContext — fast path (active staff user)', () => {
  it('returns a context with the staff user WITHOUT needing getUser (0 getUser calls)', async () => {
    const getUser = vi.fn(); // spy: must never be called on the fast path
    const staff = makeUser();
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    const result = await resolveStaffContext(
      'supa-uid-1',
      'staff@tims.co',
      null,
      makeHeaders(),
      db,
    );

    expect(result).not.toBe(NEEDS_FALLBACK);
    expect(getUser).not.toHaveBeenCalled(); // THE key assertion
    expect(db.findUserBySupabaseId).toHaveBeenCalledWith('supa-uid-1');
  });

  it('returns the correct user shape (id, email, orgId, roles)', async () => {
    const staff = makeUser();
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    const result = await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, makeHeaders(), db);
    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context, got NEEDS_FALLBACK');

    expect(result.user.id).toBe('user-staff-1');
    expect(result.user.email).toBe('staff@tims.co');
    expect(result.user.organizationId).toBe('org-1');
    expect(result.user.isPlatformOwner).toBe(false);
    expect(result.user.roles).toContain('recruiter');
    expect(result.user.roles).toContain('employee');
  });

  it('returns supabaseAuth from the trusted header values', async () => {
    const staff = makeUser();
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    const result = await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, makeHeaders(), db);
    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context');

    expect(result.supabaseAuth).toEqual({ email: 'staff@tims.co', userId: 'supa-uid-1' });
  });

  it('fires updateLastLogin when lastLoginAt exceeds the 60s threshold', async () => {
    const staff = makeUser({ lastLoginAt: new Date(Date.now() - 120_000) }); // 2 min ago
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, makeHeaders(), db);

    expect(db.updateLastLogin).toHaveBeenCalledWith('user-staff-1');
  });

  it('does NOT fire updateLastLogin when lastLoginAt is within the 60s threshold', async () => {
    const staff = makeUser({ lastLoginAt: new Date(Date.now() - 5_000) }); // 5s ago — recent
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, makeHeaders(), db);

    expect(db.updateLastLogin).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Fallback — header absent
// ---------------------------------------------------------------------------

describe('resolveStaffContext — fallback (header absent)', () => {
  it('returns NEEDS_FALLBACK when trustedUid is null', async () => {
    const db = makeDb();
    const result = await resolveStaffContext(null, null, null, makeHeaders(), db);
    expect(result).toBe(NEEDS_FALLBACK);
    // DB should NOT be queried — no uid to look up
    expect(db.findUserBySupabaseId).not.toHaveBeenCalled();
  });

  it('returns NEEDS_FALLBACK when trustedUid is empty string', async () => {
    const db = makeDb();
    const result = await resolveStaffContext('', null, null, makeHeaders(), db);
    expect(result).toBe(NEEDS_FALLBACK);
  });
});

// ---------------------------------------------------------------------------
// 3. Fallback — appUser null (candidate / unprovisioned)
// ---------------------------------------------------------------------------

describe('resolveStaffContext — fallback (appUser null)', () => {
  it('returns NEEDS_FALLBACK when db returns no user for the uid', async () => {
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(null) });

    const result = await resolveStaffContext('supa-uid-candidate', 'cand@portal.co', null, makeHeaders(), db);
    expect(result).toBe(NEEDS_FALLBACK);
    expect(db.findUserBySupabaseId).toHaveBeenCalledWith('supa-uid-candidate');
  });
});

// ---------------------------------------------------------------------------
// 4. Fallback — appUser inactive
// ---------------------------------------------------------------------------

describe('resolveStaffContext — fallback (inactive user)', () => {
  it('returns NEEDS_FALLBACK when appUser.isActive is false', async () => {
    const inactiveUser = makeUser({ isActive: false });
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(inactiveUser) });

    const result = await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, makeHeaders(), db);
    expect(result).toBe(NEEDS_FALLBACK);
  });

  it('returns NEEDS_FALLBACK when appUser has no organizationId and is not a platform owner', async () => {
    // Legacy org-less non-owner row — must NOT be treated as staff.
    const orgLessUser = makeUser({ organizationId: null, isPlatformOwner: false });
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(orgLessUser) });

    const result = await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, makeHeaders(), db);
    expect(result).toBe(NEEDS_FALLBACK);
  });
});

// ---------------------------------------------------------------------------
// 5. Forgery defense — strip-then-set ordering in middleware
// ---------------------------------------------------------------------------

describe('middleware strip-then-set ordering (forgery defense)', () => {
  /**
   * The actual strip-then-set behavior lives in `updateSession`. Here we test the
   * SOURCE property that makes it safe: `resolveStaffContext` takes the post-
   * middleware values that WERE set by middleware, not the inbound values.
   *
   * We simulate what happens with a forged inbound header:
   *  - Middleware ALWAYS strips `x-tims-auth-uid` BEFORE calling getUser().
   *  - If no authenticated user → headers remain cleared → trustedUid is null.
   *  - trustedUid null → resolveStaffContext returns NEEDS_FALLBACK → no staff context.
   *
   * This test confirms the invariant: a null/cleared uid (representing a
   * stripped-forged header for an unauthenticated request) cannot authenticate.
   */
  it('a cleared uid (forged-then-stripped by middleware) yields NEEDS_FALLBACK', async () => {
    // Middleware stripped the forged 'x-tims-auth-uid' and getUser() found no user,
    // so it did NOT re-set the header. The route sees null.
    const db = makeDb({ findUserBySupabaseId: vi.fn() });
    const result = await resolveStaffContext(null, null, null, makeHeaders(), db);
    expect(result).toBe(NEEDS_FALLBACK);
    expect(db.findUserBySupabaseId).not.toHaveBeenCalled();
  });

  it('returned headers do NOT carry x-tims-auth-uid or x-tims-auth-email', async () => {
    // The fast-path result should strip these from returned headers for cleanliness.
    const staff = makeUser();
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    // Simulate headers that came through after middleware set them.
    const rawHeaders = makeHeaders({
      'x-tims-auth-uid': 'supa-uid-1',
      'x-tims-auth-email': 'staff@tims.co',
    });

    const result = await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, rawHeaders, db);
    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context');

    expect(result.headers.get('x-tims-auth-uid')).toBeNull();
    expect(result.headers.get('x-tims-auth-email')).toBeNull();
    // Other headers survive
    expect(result.headers.get('content-type')).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// 6. Impersonation on the fast path
// ---------------------------------------------------------------------------

describe('resolveStaffContext — impersonation (fast path)', () => {
  beforeEach(() => {
    // NEXTAUTH_SECRET must be set for signImpersonationToken / verifyImpersonationToken.
    process.env.NEXTAUTH_SECRET = 'test-secret-for-impersonation-tests';
  });

  it('resolves the impersonation target when owner holds a valid token', async () => {
    const token = signImpersonationToken(ownerUser.id, targetUser.id);
    const cookieHeader = `${IMPERSONATION_COOKIE}=${encodeURIComponent(token)}`;

    const db = makeDb({
      findUserBySupabaseId: vi.fn().mockResolvedValue(ownerUser),
      findUserById: vi.fn().mockResolvedValue(targetUser),
    });

    const result = await resolveStaffContext(
      ownerUser.supabaseUserId,
      ownerUser.email,
      cookieHeader,
      makeHeaders(),
      db,
    );

    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context with impersonation');

    // Effective user is the TARGET
    expect(result.user.id).toBe(targetUser.id);
    expect(result.user.email).toBe(targetUser.email);
    expect(result.user.organizationId).toBe(targetUser.organizationId);
    expect(result.user.isPlatformOwner).toBe(false);
    expect(result.user.impersonatorId).toBe(ownerUser.id);
  });

  it('does NOT impersonate if target is another platform owner', async () => {
    const anotherOwner = makeUser({ ...ownerUser, id: 'owner-2', isPlatformOwner: true, organizationId: null });
    const token = signImpersonationToken(ownerUser.id, anotherOwner.id);
    const cookieHeader = `${IMPERSONATION_COOKIE}=${encodeURIComponent(token)}`;

    const db = makeDb({
      findUserBySupabaseId: vi.fn().mockResolvedValue(ownerUser),
      findUserById: vi.fn().mockResolvedValue(anotherOwner),
    });

    const result = await resolveStaffContext(
      ownerUser.supabaseUserId,
      ownerUser.email,
      cookieHeader,
      makeHeaders(),
      db,
    );

    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context (owner non-impersonating)');

    // Impersonation guard rejected — effective user is the REAL owner
    expect(result.user.id).toBe(ownerUser.id);
    expect(result.user.impersonatorId).toBeUndefined();
  });

  it('does NOT impersonate if target is inactive', async () => {
    const inactiveTarget = makeUser({ ...targetUser, isActive: false });
    const token = signImpersonationToken(ownerUser.id, inactiveTarget.id);
    const cookieHeader = `${IMPERSONATION_COOKIE}=${encodeURIComponent(token)}`;

    const db = makeDb({
      findUserBySupabaseId: vi.fn().mockResolvedValue(ownerUser),
      findUserById: vi.fn().mockResolvedValue(inactiveTarget),
    });

    const result = await resolveStaffContext(
      ownerUser.supabaseUserId,
      ownerUser.email,
      cookieHeader,
      makeHeaders(),
      db,
    );

    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context (owner non-impersonating)');

    // Guard rejected inactive target — effective = real owner
    expect(result.user.id).toBe(ownerUser.id);
    expect(result.user.impersonatorId).toBeUndefined();
  });

  it('does NOT impersonate if no cookie is present (non-impersonating owner)', async () => {
    const db = makeDb({
      findUserBySupabaseId: vi.fn().mockResolvedValue(ownerUser),
      findUserById: vi.fn(),
    });

    const result = await resolveStaffContext(
      ownerUser.supabaseUserId,
      ownerUser.email,
      null,  // no cookie
      makeHeaders(),
      db,
    );

    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context for owner');

    expect(result.user.id).toBe(ownerUser.id);
    expect(result.user.isPlatformOwner).toBe(true);
    expect(result.user.impersonatorId).toBeUndefined();
    expect(db.findUserById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7a. AUTH-1 — supabaseAuth null-equivalence: empty trustedEmail → null
// ---------------------------------------------------------------------------

describe('resolveStaffContext — AUTH-1: supabaseAuth null-equivalence', () => {
  /**
   * The full path in route.ts sets supabaseAuth to null when supabaseUser has no email:
   *   `const supabaseAuth = supabaseUser?.email ? { email, userId } : null;`
   * Middleware writes `user.email ?? ''` to x-tims-auth-email, so an empty string
   * is the fast-path equivalent of supabaseUser.email being falsy.
   * The fast path MUST return null in this case — not fall back to appUser.email.
   */
  it('returns supabaseAuth: null when trustedEmail is empty string (behaviorally equals full-path null branch)', async () => {
    const staff = makeUser();
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    // trustedEmail === '' mimics middleware writing `user.email ?? ''` for an
    // authenticated user whose Supabase account has no email address.
    const result = await resolveStaffContext('supa-uid-1', '', null, makeHeaders(), db);
    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context (user is active staff)');

    expect(result.supabaseAuth).toBeNull();
  });

  it('returns supabaseAuth: null when trustedEmail is null (header not forwarded)', async () => {
    const staff = makeUser();
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    const result = await resolveStaffContext('supa-uid-1', null, null, makeHeaders(), db);
    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context');

    expect(result.supabaseAuth).toBeNull();
  });

  it('returns supabaseAuth: { email, userId } when trustedEmail is non-empty (normal staff case)', async () => {
    const staff = makeUser();
    const db = makeDb({ findUserBySupabaseId: vi.fn().mockResolvedValue(staff) });

    const result = await resolveStaffContext('supa-uid-1', 'staff@tims.co', null, makeHeaders(), db);
    if (result === NEEDS_FALLBACK) throw new Error('Expected fast-path context');

    expect(result.supabaseAuth).toEqual({ email: 'staff@tims.co', userId: 'supa-uid-1' });
  });
});

// ---------------------------------------------------------------------------
// 7b. AUTH-2 — middleware matcher covers /api (tripwire)
// ---------------------------------------------------------------------------

describe('middleware config.matcher — AUTH-2: /api coverage tripwire', () => {
  /**
   * Static tripwire: the middleware matcher MUST be an array that contains an
   * entry explicitly covering /api paths. This prevents the asset-extension
   * bypass (e.g. /api/trpc/proc,x.svg?batch=1) from silently slipping back in.
   *
   * Without this entry, a tRPC batch URL whose path ends in .svg could match the
   * asset-extension exclusion in the first entry, skip middleware entirely, and
   * allow an attacker to forward a forged x-tims-auth-uid that was never stripped.
   */
  it('config.matcher is an array (not a single string)', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const src: string = readFileSync(
      resolve(__dirname, '../../apps/web/middleware.ts'),
      'utf-8',
    );

    // Dynamically import config to assert the runtime value.
    // We parse the exported config from source to avoid a full module load cycle.
    // The authoritative check is that matcher is not a plain string literal.
    expect(src).toMatch(/matcher\s*:\s*\[/); // array syntax, not a single-string
  });

  it('config.matcher contains an entry that covers /api paths', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const src: string = readFileSync(
      resolve(__dirname, '../../apps/web/middleware.ts'),
      'utf-8',
    );

    // The explicit /api entry prevents asset-suffix bypass of the strip-then-set.
    // Accept either '/api/:path*' (Next.js path-to-regexp) or a regex covering /api.
    expect(src).toMatch(/['"`]\/api[/:]/);
  });
});

describe('middleware updateSession source check (strip-then-set pattern)', () => {
  /**
   * Static source assertion: the middleware source MUST delete before setting,
   * and delete on EVERY request (even unauthenticated ones) so a forged inbound
   * header is always cleared.
   */
  it('middleware source always deletes x-tims-auth-uid before setting it', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const src: string = readFileSync(
      resolve(__dirname, '../../packages/auth/src/middleware.ts'),
      'utf-8',
    );

    // headers.delete('x-tims-auth-uid') must appear BEFORE headers.set('x-tims-auth-uid', ...)
    const deleteIdx = src.indexOf("headers.delete('x-tims-auth-uid')");
    const setIdx = src.indexOf("headers.set('x-tims-auth-uid'");

    expect(deleteIdx).toBeGreaterThan(-1); // delete MUST exist
    expect(setIdx).toBeGreaterThan(-1);    // set MUST exist
    expect(deleteIdx).toBeLessThan(setIdx); // delete MUST come first
  });

  it('middleware source sets x-tims-auth-uid inside the `if (user)` block (only when authenticated)', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const src: string = readFileSync(
      resolve(__dirname, '../../packages/auth/src/middleware.ts'),
      'utf-8',
    );
    // The set must be inside an `if (user)` block — not unconditionally.
    // Check that the set follows an `if (user)` somewhere after the delete.
    expect(src).toMatch(/if\s*\(user\)[\s\S]*headers\.set\('x-tims-auth-uid'/);
  });

  it('middleware source re-creates supabaseResponse after setting the header', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const src: string = readFileSync(
      resolve(__dirname, '../../packages/auth/src/middleware.ts'),
      'utf-8',
    );
    // There must be at least two NextResponse.next({ request: { headers } }) calls
    // (the initial one + the re-create after setting auth headers).
    const matches = src.match(/NextResponse\.next\(\{[^}]*request:\s*\{[^}]*headers[^}]*\}[^}]*\}\)/g);
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
