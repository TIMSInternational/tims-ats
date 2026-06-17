import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Staff/candidate auth-link boundary — Approach B2 (invite-time linking).
// See docs/SECURITY-staff-candidate-auth-linking.md. Staff `User` rows are linked to
// their Supabase identity AT CREATION; no site joins staff to a row by email. These
// static assertions lock that invariant: (1) creation sites stamp a real id via the
// provisioning service (no '' / pending-* sentinel), and (2) every recognition site
// matches by supabaseUserId only.

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PROVISION = read('packages/api/src/services/staff-provisioning.service.ts');
const USER_ROUTER = read('packages/api/src/routers/user.ts');
const OFFER_LIFECYCLE = read('packages/api/src/routers/offer/lifecycle.ts');
const TRPC_ROUTE = read('apps/web/app/api/trpc/[trpc]/route.ts');
const CALLBACK = read('apps/web/app/auth/callback/route.ts');
// The admin layout + dashboard page now resolve identity through this shared
// server-only helper (impersonation-effective identity), so the staff-recognition
// guard + /logout redirect live here. The RSCs are thin consumers of it.
const EFFECTIVE_IDENTITY = read('apps/web/lib/auth/effective-identity.ts');
const LOGOUT = read('apps/web/app/logout/route.ts');

describe('staff provisioning service (invite-time linking)', () => {
  it('reuses an existing Supabase identity by email, else invites a new one', () => {
    expect(PROVISION).toMatch(/FROM auth\.users/);
    expect(PROVISION).toContain('inviteUserByEmail');
  });

  it('rejects an auth id already owned by a REAL staff row with a clean CONFLICT (no raw P2002)', () => {
    expect(PROVISION).toMatch(/findUnique\(\{\s*where:\s*\{\s*supabaseUserId/);
    expect(PROVISION).toMatch(/code:\s*'CONFLICT'/);
    // Conflict only for org-scoped or platform-owner rows.
    expect(PROVISION).toMatch(/isPlatformOwner\s*\|\|\s*owner\.organizationId/);
  });

  it('reclaims (tombstones) a legacy org-less candidate row so its auth id can be reused', () => {
    expect(PROVISION).toMatch(/tombstone-\$\{owner\.id\}/);
  });
});

describe('staff creation sites stamp a real Supabase id (no unclaimed sentinel)', () => {
  it('user.create links via the provisioning service, not supabaseUserId: ""', () => {
    expect(USER_ROUTER).toContain('resolveStaffSupabaseUserId');
    expect(USER_ROUTER).not.toMatch(/supabaseUserId:\s*''/);
  });

  it('user.create rejects a duplicate BEFORE provisioning an auth identity', () => {
    // Otherwise a fresh Supabase invite is sent and then the insert fails on the
    // org/email unique — orphaning the auth identity + emailing a former user.
    const dupCheck = USER_ROUTER.indexOf('equals: userData.email, mode: ');
    const provision = USER_ROUTER.indexOf('resolveStaffSupabaseUserId(userData.email)');
    expect(dupCheck).toBeGreaterThan(-1);
    expect(provision).toBeGreaterThan(dupCheck);
  });

  it('employee conversion links via the provisioning service, not a pending- sentinel', () => {
    expect(OFFER_LIFECYCLE).toContain('resolveStaffSupabaseUserId');
    expect(OFFER_LIFECYCLE).not.toMatch(/pending-/);
  });
});

describe('every recognition site matches by supabaseUserId only (no email-join)', () => {
  it('tRPC context builder does not look up a staff User by email', () => {
    expect(TRPC_ROUTE).not.toMatch(/db\.user\.findFirst/);
    // No write of supabaseUserId from the context builder (no claiming).
    expect(/db\.user\.update\([^)]*supabaseUserId:/s.test(TRPC_ROUTE)).toBe(false);
  });

  it('/auth/callback recognizes by supabaseUserId, not an email OR-match', () => {
    expect(CALLBACK).toMatch(/findFirst\(\{\s*where:\s*\{\s*supabaseUserId/);
    expect(CALLBACK).not.toMatch(/OR:\s*\[\s*\{\s*supabaseUserId/);
  });

  it('/auth/callback no longer mints an org-less candidate User row', () => {
    // Candidates use the portal magic-link, not a users row. The legacy candidate
    // self-signup creation (which id-only recognition would treat as staff) is gone.
    expect(CALLBACK).not.toContain("'Candidato'");
  });

  it('staff recognition requires active + org-scoped-or-owner (rejects legacy org-less rows)', () => {
    // tRPC context + admin SSR (via the shared effective-identity helper) must not
    // treat an inactive or org-less non-owner row as staff just because it shares
    // the Supabase id.
    expect(TRPC_ROUTE).toMatch(/!appUser\.isActive\s*\|\|\s*\(!appUser\.isPlatformOwner\s*&&\s*!appUser\.organizationId\)/);
    expect(EFFECTIVE_IDENTITY).toMatch(/!appUser\.isActive\s*\|\|\s*\(!appUser\.isPlatformOwner\s*&&\s*!appUser\.organizationId\)/);
  });

  it('the effective-identity helper looks up the staff row by supabaseUserId and never email', () => {
    expect(EFFECTIVE_IDENTITY).toMatch(/findUnique\(\{\s*where:\s*\{\s*supabaseUserId/);
    expect(EFFECTIVE_IDENTITY).not.toMatch(/email:\s*supabaseUser\.email/);
  });
});

describe('unlinked sessions exit without a redirect loop', () => {
  it('the admin SSR identity helper sends unlinked sessions to /logout (not /login)', () => {
    expect(EFFECTIVE_IDENTITY).toMatch(/redirect\('\/logout'\)/);
  });

  it('/logout clears the Supabase session then redirects to /login', () => {
    expect(LOGOUT).toContain('signOut');
    expect(LOGOUT).toMatch(/\/login/);
  });
});
