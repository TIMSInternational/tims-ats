/**
 * mfa-enforcement.test.ts — CB-2a
 *
 * Pins the API-layer MFA enforcement gate that closes the page-only bypass:
 *  1. `isMfaPrivileged` — the shared privileged set (single source of truth for the
 *     page gate AND the tRPC gate; a drift here would let a role escape MFA).
 *  2. The `withMfaEnforcement` middleware behavior — a privileged aal1 session is
 *     BLOCKED with an `MFA_REQUIRED` FORBIDDEN when enforced; aal2 / non-privileged /
 *     not-enforced all pass; the block emits exactly one `mfa_step_up_required` event
 *     and the CB-1c observer does NOT also log it as `authz_denied`.
 *  3. Static wiring guards so a refactor that drops the gate / transport goes red.
 *
 * Strategy mirrors CB-1c (mock @tims/db, mini-tRPC caller replicating the middleware,
 * static source guards).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTRPC, TRPCError } from '@trpc/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isMfaPrivileged,
  isMfaEnforced,
  isMfaSatisfied,
  isMfaGateBlocking,
  MFA_REQUIRED,
} from '@tims/shared';

const createMock = vi.fn();
vi.mock('@tims/db', () => ({
  db: { auditLog: { create: (args: unknown) => createMock(args) } },
  Prisma: {},
}));

import { observeDenial } from '../../packages/api/src/access/security-audit';

const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => createMock.mockReset());

// ---------------------------------------------------------------------------
// 1. isMfaPrivileged — the shared privileged set
// ---------------------------------------------------------------------------
describe('isMfaPrivileged — mirrors the (admin) page gate + trpc.ts privileged set', () => {
  it('is privileged for platform owners (by flag)', () => {
    expect(isMfaPrivileged({ roles: [], isPlatformOwner: true })).toBe(true);
  });
  it('is privileged for super_admin / platform_owner role slugs', () => {
    expect(isMfaPrivileged({ roles: ['super_admin'], isPlatformOwner: false })).toBe(true);
    expect(isMfaPrivileged({ roles: ['platform_owner'], isPlatformOwner: false })).toBe(true);
  });
  it('is NOT privileged for ordinary staff roles', () => {
    expect(isMfaPrivileged({ roles: ['hr_admin', 'recruiter', 'employee'], isPlatformOwner: false })).toBe(false);
    expect(isMfaPrivileged({ roles: [], isPlatformOwner: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. withMfaEnforcement middleware behavior (replicated mini-tRPC, real shared fns)
// ---------------------------------------------------------------------------
describe('withMfaEnforcement — API-layer gate', () => {
  type Ctx = {
    user: { id: string; organizationId: string; roles: string[]; isPlatformOwner: boolean; impersonatorId?: string } | null;
    aal?: string | null;
    headers: Headers;
  };
  const t = initTRPC.context<Ctx>().create();

  // Replicate EXACTLY the trpc.ts middleware body (guarded by static asserts below).
  const withMfaEnforcement = t.middleware(({ ctx, next }) => {
    if (
      ctx.user &&
      isMfaGateBlocking({
        enforced: isMfaEnforced(process.env.MFA_ENFORCED),
        isPrivileged:
          isMfaPrivileged({ roles: ctx.user.roles, isPlatformOwner: ctx.user.isPlatformOwner }) ||
          Boolean(ctx.user.impersonatorId),
        currentLevel: ctx.aal,
      })
    ) {
      // fire-and-forget audit — same as the real middleware
      createMock({ data: { organizationId: ctx.user.organizationId, action: 'mfa_step_up_required', entity: 'mfa' } });
      throw new TRPCError({ code: 'FORBIDDEN', message: MFA_REQUIRED });
    }
    return next();
  });
  const proc = t.procedure.use(withMfaEnforcement);
  const appRouter = t.router({ ping: proc.query(() => 'ok') });

  const priv = { id: 'u1', organizationId: 'org1', roles: ['super_admin'], isPlatformOwner: false };
  const plain = { id: 'u2', organizationId: 'org1', roles: ['recruiter'], isPlatformOwner: false };

  afterEach(() => { delete process.env.MFA_ENFORCED; });

  it('BLOCKS a privileged aal1 session with MFA_REQUIRED when enforced', async () => {
    process.env.MFA_ENFORCED = 'true';
    const caller = appRouter.createCaller({ user: priv, aal: 'aal1', headers: new Headers() });
    await expect(caller.ping()).rejects.toMatchObject({ code: 'FORBIDDEN', message: MFA_REQUIRED });
    expect(createMock).toHaveBeenCalledTimes(1); // the mfa_step_up_required audit
  });

  it('ALLOWS a privileged session stepped up to aal2', async () => {
    process.env.MFA_ENFORCED = 'true';
    const caller = appRouter.createCaller({ user: priv, aal: 'aal2', headers: new Headers() });
    await expect(caller.ping()).resolves.toBe('ok');
  });

  it('ALLOWS a non-privileged aal1 session even when enforced', async () => {
    process.env.MFA_ENFORCED = 'true';
    const caller = appRouter.createCaller({ user: plain, aal: 'aal1', headers: new Headers() });
    await expect(caller.ping()).resolves.toBe('ok');
  });

  it('is a NO-OP when MFA_ENFORCED is off (a privileged aal1 session passes)', async () => {
    const caller = appRouter.createCaller({ user: priv, aal: 'aal1', headers: new Headers() });
    await expect(caller.ping()).resolves.toBe('ok');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('BLOCKS an IMPERSONATING aal1 operator even though the effective user is non-privileged', async () => {
    // The crown-jewel bypass (H1/H2): during impersonation ctx.user is the non-priv
    // target, but impersonatorId marks a real platform owner + ctx.aal is the operator's
    // own level. The gate must key on that, not the effective (target) privilege.
    process.env.MFA_ENFORCED = 'true';
    const impersonating = { ...plain, impersonatorId: 'owner1' };
    const caller = appRouter.createCaller({ user: impersonating, aal: 'aal1', headers: new Headers() });
    await expect(caller.ping()).rejects.toMatchObject({ code: 'FORBIDDEN', message: MFA_REQUIRED });
  });

  it('ALLOWS an impersonating operator who stepped up to aal2', async () => {
    process.env.MFA_ENFORCED = 'true';
    const impersonating = { ...plain, impersonatorId: 'owner1' };
    const caller = appRouter.createCaller({ user: impersonating, aal: 'aal2', headers: new Headers() });
    await expect(caller.ping()).resolves.toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// observeDenial must NOT double-log an MFA-marked denial as authz_denied
// ---------------------------------------------------------------------------
describe('observeDenial — skips the MFA_REQUIRED marker (no double-log)', () => {
  it('does not write authz_denied for an MFA_REQUIRED FORBIDDEN', async () => {
    observeDenial({
      error: new TRPCError({ code: 'FORBIDDEN', message: MFA_REQUIRED }),
      path: 'user.me',
      ctx: { user: { id: 'u1', organizationId: 'org1', impersonatorId: null }, headers: new Headers() },
    });
    await flush();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('still writes authz_denied for an ordinary FORBIDDEN (control)', async () => {
    createMock.mockResolvedValueOnce({});
    observeDenial({
      error: new TRPCError({ code: 'FORBIDDEN', message: 'No tienes permiso' }),
      path: 'user.me',
      ctx: { user: { id: 'u1', organizationId: 'org1', impersonatorId: null }, headers: new Headers() },
    });
    await flush();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Static wiring guards
// ---------------------------------------------------------------------------
const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('wiring — MFA enforcement is composed and transported end to end', () => {
  it('trpc.ts: protectedProcedure composes withMfaEnforcement, gated on isMfaPrivileged + MFA_ENFORCED + aal', () => {
    const src = read('packages/api/src/trpc.ts');
    expect(src).toMatch(/\.use\(withMfaEnforcement\)/);
    expect(src).toMatch(/isMfaPrivileged/);
    expect(src).toMatch(/isMfaEnforced\(process\.env\.MFA_ENFORCED\)/);
    const block = src.slice(src.indexOf('withMfaEnforcement ='));
    expect(block).toMatch(/MFA_REQUIRED/);
    expect(block).toMatch(/mfa_step_up_required/);
    // Impersonation is treated as privileged (real operator is always an owner).
    expect(block).toMatch(/ctx\.user\.impersonatorId/);
  });

  it('impersonate/start REST route is MFA-gated (privileged raw action outside tRPC)', () => {
    const src = read('apps/web/app/api/impersonate/start/route.ts');
    expect(src).toMatch(/isMfaEnforced\(process\.env\.MFA_ENFORCED\)/);
    expect(src).toMatch(/getAuthenticatorAssuranceLevel/);
    expect(src).toMatch(/isMfaSatisfied/);
    expect(src).toMatch(/MFA_REQUIRED/);
  });

  it('impersonate button redirects to /mfa on the MFA_REQUIRED 403', () => {
    const src = read('apps/web/app/(admin)/platform/users/user-table.tsx');
    expect(src).toMatch(/MFA_REQUIRED/);
    expect(src).toMatch(/\/mfa/);
  });

  it('context.ts: TRPCContext carries aal', () => {
    expect(read('packages/api/src/context.ts')).toMatch(/aal\??:\s*string \| null/);
  });

  it('route.ts: createContext reads the x-tims-auth-aal trusted header', () => {
    expect(read('apps/web/app/api/trpc/[trpc]/route.ts')).toMatch(/x-tims-auth-aal/);
  });

  it('auth middleware: strips AND forwards x-tims-auth-aal (forgery-safe transport)', () => {
    const src = read('packages/auth/src/middleware.ts');
    expect(src).toMatch(/delete\(['"]x-tims-auth-aal['"]\)/);
    expect(src).toMatch(/set\(['"]x-tims-auth-aal['"]/);
    expect(src).toMatch(/getAuthenticatorAssuranceLevel/);
  });

  it('(admin) layout: uses the SHARED isMfaPrivileged (parity with the API gate)', () => {
    expect(read('apps/web/app/(admin)/layout.tsx')).toMatch(/isMfaPrivileged/);
  });

  it('web tRPC client: redirects to /mfa on the MFA_REQUIRED marker', () => {
    const src = read('apps/web/lib/trpc-provider.tsx');
    expect(src).toMatch(/MFA_REQUIRED/);
    expect(src).toMatch(/\/mfa/);
  });
});
