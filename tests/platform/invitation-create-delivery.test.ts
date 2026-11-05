/**
 * invitation-create-delivery.test.ts — audit finding D-04 and proof-run finding F-1 (TS half).
 *
 * D-04: platform.createUserInvitation / createOrgInvitation stored every invitation as `sent` and returned
 * success even when SES refused the email (sendEmail returns false, it never throws), so the owner saw a
 * green toast for an invitation nobody received. They now store `pending`, mark `sent` only after SES
 * accepted the email, and return the same delivery vocabulary as the C# writers.
 *
 * F-1: the email printed the raw role slug ("recruiter"; "Administrador" for org admins). It now prints the
 * shared label.
 *
 * Mock strategy mirrors invitations-export-cap.test.ts: pass-through procedure builders (the real
 * platformProcedure owner gate from ./_common still runs) and a mocked @tims/db that records writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initTRPC } from '@trpc/server';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
  findOrg: vi.fn(),
  findRole: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@tims/db', () => {
  const db = {
    organization: {
      findUnique: m.findOrg,
      create: vi.fn(async () => ({ id: '33333333-3333-4333-8333-333333333333' })),
    },
    role: { findFirst: m.findRole },
    subscription: { create: vi.fn() },
    platformInvitation: { create: m.create, updateMany: m.updateMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return {
    db,
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
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: m.sendEmail }));
vi.mock('../../packages/api/src/services/org-provisioning', () => ({
  provisionOrgDefaults: vi.fn(),
  provisionOrgEntitlements: vi.fn(),
  provisionOrgRoles: vi.fn(),
}));
vi.mock('@tims/shared', async (original) => ({
  ...(await original<typeof import('@tims/shared')>()),
  getAppUrl: () => 'https://app.example.test',
}));
vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
    .create();
  return { router: t.router, publicProcedure: t.procedure, protectedProcedure: t.procedure };
});

import { invitationsRouter } from '../../packages/api/src/routers/platform/invitations';

const t = initTRPC
  .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
  .create();
const createCaller = t.createCallerFactory(invitationsRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

type Created = { id: string; status: string; sentAt: Date | null; delivery: string };
interface InvitationCaller {
  createUserInvitation(input: Record<string, unknown>): Promise<Created>;
  createOrgInvitation(input: Record<string, unknown>): Promise<Created>;
}
const caller = () =>
  createCaller({
    user: { id: 'owner-1', organizationId: '99999999-9999-4999-8999-999999999999', isPlatformOwner: true },
    headers: new Headers(),
  }) as unknown as InvitationCaller;

const ORG = '22222222-2222-4222-8222-222222222222';
const userInput = { email: 'invitee@example.test', organizationId: ORG, roleSlug: 'recruiter' };
const orgInput = { email: 'admin@example.test', organizationName: 'Org Piloto', organizationSlug: 'org-piloto' };

beforeEach(() => {
  vi.clearAllMocks();
  m.findOrg.mockResolvedValue({ name: 'Org Piloto', isActive: true, deletedAt: null });
  m.findRole.mockResolvedValue({ id: 'role-1' });
  m.create.mockImplementation(async ({ data }: { data: { status: string } }) => ({
    id: '11111111-1111-4111-8111-111111111111',
    status: data.status,
    sentAt: null,
  }));
  m.updateMany.mockResolvedValue({ count: 1 });
});

describe.each([
  ['createUserInvitation', () => caller().createUserInvitation(userInput)],
  ['createOrgInvitation', () => caller().createOrgInvitation(orgInput)],
] as const)('platform.%s reports delivery honestly (D-04)', (_name, run) => {
  it('stores the invitation as pending, never pre-marked sent', async () => {
    m.sendEmail.mockResolvedValue(false);
    await run();
    const data = m.create.mock.calls[0][0].data as { status: string; sentAt?: Date };
    expect(data.status).toBe('pending');
    expect(data.sentAt).toBeUndefined();
  });

  it('keeps it pending and returns "unconfirmed" when SES refused the email', async () => {
    m.sendEmail.mockResolvedValue(false);
    const result = await run();
    expect(result.delivery).toBe('unconfirmed');
    expect(result.status).toBe('pending');
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('marks it sent (guarded on pending) and returns "accepted" once SES took the email', async () => {
    m.sendEmail.mockResolvedValue(true);
    const result = await run();
    expect(result.delivery).toBe('accepted');
    expect(result.status).toBe('sent');
    expect(result.sentAt).toBeInstanceOf(Date);
    const call = m.updateMany.mock.calls[0][0] as { where: unknown; data: { status: string; sentAt: Date } };
    expect(call.where).toEqual({ id: '11111111-1111-4111-8111-111111111111', status: 'pending' });
    expect(call.data.status).toBe('sent');
    expect(call.data.sentAt).toBeInstanceOf(Date);
  });

  it('returns "changed" when the row left pending meanwhile, and "state_unconfirmed" when the write failed', async () => {
    m.sendEmail.mockResolvedValue(true);
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await run()).delivery).toBe('changed');
    m.updateMany.mockRejectedValueOnce(new Error('db down'));
    expect((await run()).delivery).toBe('state_unconfirmed');
  });
});

describe('invitation emails name the role by its label (F-1)', () => {
  it('user invitation: "Reclutador", not the slug', async () => {
    m.sendEmail.mockResolvedValue(true);
    await caller().createUserInvitation(userInput);
    const { html, subject } = m.sendEmail.mock.calls[0][0] as { html: string; subject: string };
    expect(html).toContain('<br>Reclutador<br>');
    expect(html).not.toContain('<br>recruiter<br>');
    expect(subject).toBe('Invitación para unirte a Org Piloto en TIMS ATS');
  });

  it('organization invitation: the admin is accepted as super_admin, so "Super Administrador"', async () => {
    m.sendEmail.mockResolvedValue(true);
    await caller().createOrgInvitation(orgInput);
    const { html } = m.sendEmail.mock.calls[0][0] as { html: string };
    expect(html).toContain('<br>Super Administrador<br>');
    expect(html).not.toContain('<br>Administrador<br>');
  });
});
