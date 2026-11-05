/**
 * Platform-owner mutations now leave an audit trail — platform-owner access-2 / access-6 / journeys-30, D-14.
 *
 * - Owner allowlist: add and remove write `audit_logs` rows; removing an address also REVOKES the owner flag of
 *   the account created from it (it used to leave a full owner behind); the caller cannot remove their own.
 * - Invitations (live tRPC path): create / resend / revoke / bulk write rows with the C# vocabulary.
 * - changeOrgUserRole: delete + create run in ONE transaction, and the user must belong to the organization.
 *
 * Harness mirrors invitation-create-delivery.test.ts: pass-through procedure builders (the real
 * platformProcedure owner gate from ./_common still runs) and a mocked @tims/db that records writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initTRPC } from '@trpc/server';

const m = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  ownerFindFirst: vi.fn(),
  ownerFindMany: vi.fn(),
  ownerCreate: vi.fn(),
  ownerDeleteMany: vi.fn(),
  userUpdateMany: vi.fn(),
  userFindFirst: vi.fn(),
  roleFindFirst: vi.fn(),
  userRoleDeleteMany: vi.fn(),
  userRoleCreate: vi.fn(),
  invFindUnique: vi.fn(),
  invUpdate: vi.fn(),
  resend: vi.fn(),
  invalidate: vi.fn(),
  txCalls: 0,
}));

vi.mock('@tims/db', () => {
  const db = {
    auditLog: { create: m.auditCreate },
    platformOwnerEmail: {
      findFirst: m.ownerFindFirst,
      findMany: m.ownerFindMany,
      create: m.ownerCreate,
      deleteMany: m.ownerDeleteMany,
    },
    user: { updateMany: m.userUpdateMany, findFirst: m.userFindFirst },
    role: { findFirst: m.roleFindFirst },
    userRole: { deleteMany: m.userRoleDeleteMany, create: m.userRoleCreate },
    platformInvitation: { findUnique: m.invFindUnique, update: m.invUpdate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      m.txCalls += 1;
      return fn(db);
    },
  };
  return {
    db,
    Prisma: {},
    InvitationType: { org_admin: 'org_admin', user: 'user' },
    InvitationStatus: {
      pending: 'pending',
      sent: 'sent',
      accepted: 'accepted',
      expired: 'expired',
      revoked: 'revoked',
    },
  };
});
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: vi.fn() }));
vi.mock('../../packages/api/src/services/bulk-invitation.service', () => ({
  bulkInviteUsers: vi.fn(),
  resendInvitation: m.resend,
}));
vi.mock('../../packages/api/src/services/org-provisioning', () => ({
  provisionOrgDefaults: vi.fn(),
  provisionOrgEntitlements: vi.fn(),
  provisionOrgRoles: vi.fn(),
}));
vi.mock('../../packages/api/src/lib/cache', () => ({ invalidatePermissionCache: m.invalidate }));
vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<Ctx>().create();
  return { router: t.router, publicProcedure: t.procedure, protectedProcedure: t.procedure };
});

type Ctx = { user: { id: string; email: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers };

import { usersRouter } from '../../packages/api/src/routers/platform/users';
import { invitationsRouter } from '../../packages/api/src/routers/platform/invitations';

const t = initTRPC.context<Ctx>().create();
const OWNER_ORG = '99999999-9999-4999-8999-999999999999';
const ORG = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const INV = '11111111-1111-4111-8111-111111111111';
const ctx = (overrides: Partial<Ctx['user']> = {}): Ctx => ({
  user: { id: 'owner-1', email: 'owner@nexadev.test', organizationId: OWNER_ORG, isPlatformOwner: true, ...overrides },
  headers: new Headers(),
});
type AnyCaller = Record<string, (input?: unknown) => Promise<unknown>>;
const callerOf = (r: unknown, c: Ctx = ctx()) =>
  t.createCallerFactory(r as Parameters<typeof t.createCallerFactory>[0])(c) as unknown as AnyCaller;
const audits = () => m.auditCreate.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data);

beforeEach(() => {
  vi.clearAllMocks();
  m.txCalls = 0;
  m.auditCreate.mockResolvedValue({});
});

describe('owner allowlist', () => {
  it('add: lower-cases, records who added it, refuses a duplicate, and audits', async () => {
    m.ownerFindFirst.mockResolvedValue(null);
    m.ownerCreate.mockImplementation(async ({ data }: { data: { email: string } }) => ({
      email: data.email,
      createdAt: new Date(),
    }));
    await callerOf(usersRouter).addPlatformOwnerEmail({ email: '  New.Owner@NexaDev.test ' });
    expect(m.ownerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: 'new.owner@nexadev.test', addedBy: 'owner-1' } }),
    );
    expect(audits()).toEqual([
      expect.objectContaining({
        organizationId: OWNER_ORG,
        actorId: 'owner-1',
        action: 'platform_owner_email_added',
        entity: 'platform_owner_email',
        metadata: { email: 'new.owner@nexadev.test' },
      }),
    ]);

    m.ownerFindFirst.mockResolvedValue({ email: 'new.owner@nexadev.test' });
    await expect(callerOf(usersRouter).addPlatformOwnerEmail({ email: 'new.owner@nexadev.test' })).rejects.toThrow(
      /ya está en la lista/,
    );
  });

  it('remove: deletes the entry AND revokes the owner flag in one transaction, then audits', async () => {
    m.ownerFindMany.mockResolvedValue([{ email: 'old@nexadev.test' }]);
    m.userUpdateMany.mockResolvedValue({ count: 1 });
    const result = await callerOf(usersRouter).removePlatformOwnerEmail({ email: 'Old@NexaDev.test' });
    expect(result).toEqual({ email: 'old@nexadev.test', ownersRevoked: 1 });
    expect(m.txCalls).toBe(1);
    expect(m.ownerDeleteMany).toHaveBeenCalledWith({ where: { email: { in: ['old@nexadev.test'] } } });
    expect(m.userUpdateMany).toHaveBeenCalledWith({
      where: {
        email: { equals: 'Old@NexaDev.test', mode: 'insensitive' },
        isPlatformOwner: true,
        id: { not: 'owner-1' },
      },
      data: { isPlatformOwner: false },
    });
    expect(audits()).toEqual([
      expect.objectContaining({
        action: 'platform_owner_email_removed',
        metadata: { email: 'old@nexadev.test', ownersRevoked: 1 },
      }),
    ]);
  });

  it('remove: refuses the caller own address and an unknown one, writing nothing', async () => {
    await expect(callerOf(usersRouter).removePlatformOwnerEmail({ email: 'OWNER@nexadev.test' })).rejects.toThrow(
      /tu propio correo/,
    );
    m.ownerFindMany.mockResolvedValue([]);
    await expect(callerOf(usersRouter).removePlatformOwnerEmail({ email: 'ghost@nexadev.test' })).rejects.toThrow(
      /no está en la lista/,
    );
    expect(m.ownerDeleteMany).not.toHaveBeenCalled();
    expect(m.userUpdateMany).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it('an org-less operator still completes the change; the event goes to the structured log, not a broken insert', async () => {
    m.ownerFindFirst.mockResolvedValue(null);
    m.ownerCreate.mockResolvedValue({ email: 'x@nexadev.test', createdAt: new Date() });
    await callerOf(usersRouter, ctx({ organizationId: '' })).addPlatformOwnerEmail({ email: 'x@nexadev.test' });
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it('a non-owner is refused before any write', async () => {
    await expect(
      callerOf(usersRouter, ctx({ isPlatformOwner: false })).addPlatformOwnerEmail({ email: 'x@nexadev.test' }),
    ).rejects.toThrow();
    expect(m.ownerCreate).not.toHaveBeenCalled();
  });
});

describe('changeOrgUserRole (D-14)', () => {
  it('replaces the role inside one transaction and audits the previous roles', async () => {
    m.roleFindFirst.mockResolvedValue({ id: 'role-1', slug: 'committee' });
    m.userFindFirst.mockResolvedValue({
      id: USER,
      isPlatformOwner: false,
      userRoles: [{ role: { slug: 'recruiter' } }],
    });
    await callerOf(usersRouter).changeOrgUserRole({ userId: USER, organizationId: ORG, roleSlug: 'committee' });
    expect(m.txCalls).toBe(1);
    expect(m.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: USER, organizationId: ORG } }));
    expect(m.userRoleDeleteMany).toHaveBeenCalled();
    expect(m.userRoleCreate).toHaveBeenCalledWith({ data: { userId: USER, roleId: 'role-1', assignedBy: 'owner-1' } });
    expect(audits()).toEqual([
      expect.objectContaining({
        action: 'user_role_changed',
        metadata: { newRole: 'committee', previousRoles: ['recruiter'] },
      }),
    ]);
  });

  it('a user of another organization is refused and keeps their roles', async () => {
    m.roleFindFirst.mockResolvedValue({ id: 'role-1', slug: 'committee' });
    m.userFindFirst.mockResolvedValue(null);
    await expect(
      callerOf(usersRouter).changeOrgUserRole({ userId: USER, organizationId: ORG, roleSlug: 'committee' }),
    ).rejects.toThrow(/no encontrado/);
    expect(m.userRoleDeleteMany).not.toHaveBeenCalled();
  });
});

describe('invitation audit rows (access-6)', () => {
  it('revoke writes user_invitation_revoked under the invitation organization', async () => {
    m.invFindUnique.mockResolvedValue({ id: INV, status: 'sent', organizationId: ORG });
    m.invUpdate.mockResolvedValue({ id: INV, status: 'revoked' });
    await callerOf(invitationsRouter).revokeInvitation({ id: INV });
    expect(audits()).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        action: 'user_invitation_revoked',
        entity: 'platform_invitation',
        entityId: INV,
        metadata: { previousStatus: 'sent', surface: 'platform' },
      }),
    ]);
  });

  it('resend audits every outcome, including a failed delivery', async () => {
    m.invFindUnique.mockResolvedValue({ organizationId: ORG });
    m.resend.mockResolvedValue({ error: 'delivery_failed' });
    await expect(callerOf(invitationsRouter).resendInvitation({ id: INV })).rejects.toThrow();
    expect(audits()).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        action: 'invitation_resend',
        metadata: { outcome: 'delivery_failed', surface: 'platform' },
      }),
    ]);
  });
});
