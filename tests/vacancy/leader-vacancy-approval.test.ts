import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantsFor } from '../../packages/db/prisma/seed-access-matrix';

// Pilot 2026-11-06 (owner decision): a Líder sends the drafts of their own vacancies for approval and takes the
// request back. Both procedures are gated on vacancy:update, which the leader now holds at TEAM scope
// (seed-access-matrix.ts). This runs the REAL access kernel (buildAccessForUser → resolveAccess →
// scopeWhereFor → assertScoped) over the matrix rows, so it proves the grant is enough AND that the team scope
// still composes (AND) with the by-id probe: a draft outside the leader's team/assignments stays NOT_FOUND.
// Only the database is faked.

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const LEADER_ID = '10000000-0000-4000-8000-000000000001';
const HR_ID = '20000000-0000-4000-8000-000000000002';
const OWN_DRAFT = '30000000-0000-4000-8000-000000000003'; // assigned to the leader (the pilot's only team anchor)
const OTHER_DRAFT = '40000000-0000-4000-8000-000000000004'; // someone else's
const APPROVAL_ID = '50000000-0000-4000-8000-000000000005';

const m = vi.hoisted(() => ({
  probes: [] as unknown[],
  vacancyFindFirst: vi.fn(),
  txUpdateMany: vi.fn(),
  createMany: vi.fn(),
  approvalCount: vi.fn(),
  approvalUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

// The leader leads no team (the org structure is off in the pilot): the team fragment is
// { OR: [{ teamId: { in: [] } }, { assignedTo: <leader> }] }, so only vacancies assigned to them are in scope.
const teamFragment = (userId: string) => ({ OR: [{ teamId: { in: [] } }, { assignedTo: userId }] });

function inScope(where: { AND?: unknown[]; id?: string }): boolean {
  if (!where.AND) return true; // not a scope probe (the draft re-read after the probe)
  const id = (where.AND[0] as { id: string }).id;
  const fragment = where.AND[where.AND.length - 1];
  const json = JSON.stringify(fragment);
  if (json === '{}') return true; // org-wide (the HR approver's probe)
  return json === JSON.stringify(teamFragment(LEADER_ID)) && id === OWN_DRAFT;
}

vi.mock('@tims/db', () => {
  const rolePermission = {
    findMany: vi.fn(
      async (args: { where: { role: { slug: { in: string[] } }; permission: { module: string; action: string } } }) =>
        args.where.role.slug.in.flatMap((slug) =>
          grantsFor(slug)
            .filter((g) => g.module === args.where.permission.module && g.action === args.where.permission.action)
            .map((g) => ({ scope: g.scope, role: { slug }, permission: { module: g.module, action: g.action } })),
        ),
    ),
  };
  const tx = () => ({
    vacancy: {
      updateMany: m.txUpdateMany,
      findUniqueOrThrow: vi.fn(async () => ({ id: OWN_DRAFT, title: 'X', status: 'pending_approval', approvals: [] })),
      findFirstOrThrow: vi.fn(async () => ({ id: OWN_DRAFT, title: 'X', status: 'draft', approvals: [] })),
    },
    vacancyApproval: { createMany: m.createMany, count: m.approvalCount, updateMany: m.approvalUpdateMany },
    auditLog: { create: m.auditCreate },
  });
  return {
    db: { rolePermission },
    tenantDb: {
      vacancy: { findFirst: m.vacancyFindFirst },
      team: { findMany: vi.fn(async () => []) },
      user: {
        findMany: vi.fn(async () => [{ id: HR_ID, userRoles: [{ role: { slug: 'hr_admin' } }] }]),
      },
    },
    runWithTenant: (_org: string, fn: () => unknown) => fn(),
    runTenantTransaction: async (_org: string, fn: (t: unknown) => unknown) => fn(tx()),
  };
});
vi.mock('../../packages/api/src/services/approval-notification.service', () => ({
  approvalNotificationService: { notifyApprovalRequested: vi.fn(async () => undefined) },
}));

async function asLeader() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyApprovalsRouter } = await import('../../packages/api/src/routers/vacancy/approvals');
  return createCallerFactory(router({ vacancy: vacancyApprovalsRouter }))({
    user: {
      id: LEADER_ID,
      organizationId: ORG_ID,
      roles: ['leader'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'lider@acme.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.probes.length = 0;
  m.vacancyFindFirst.mockImplementation(async (args: { where: { AND?: unknown[]; id?: string } }) => {
    if (args.where.AND) m.probes.push(args.where);
    return inScope(args.where) ? { id: args.where.id ?? OWN_DRAFT } : null;
  });
  m.txUpdateMany.mockResolvedValue({ count: 1 });
  m.approvalCount.mockResolvedValue(1);
  m.approvalUpdateMany.mockResolvedValue({ count: 1 });
});

describe('the seed matrix grants the leader vacancy:update at team scope only', () => {
  it('holds vacancy read/create/update/approve, every one @team', () => {
    const vacancy = grantsFor('leader').filter((g) => g.module === 'vacancy');
    expect(vacancy.map((g) => g.action).sort()).toEqual(['approve', 'create', 'read', 'update']);
    expect(new Set(grantsFor('leader').map((g) => g.scope))).toEqual(new Set(['team']));
    // Still no publish and no offer:create: those stay with recruiters / HR.
    expect(grantsFor('leader').some((g) => g.module === 'vacancy' && g.action === 'publish')).toBe(false);
    expect(grantsFor('leader').some((g) => g.module === 'offer' && g.action === 'create')).toBe(false);
  });
});

describe('a Líder sends their own draft for approval and withdraws it', () => {
  it('submitForApproval on a draft assigned to them succeeds; the probe ANDs the team scope', async () => {
    await expect(
      (await asLeader()).vacancy.submitForApproval({ id: OWN_DRAFT, approverIds: [HR_ID] }),
    ).resolves.toMatchObject({ id: OWN_DRAFT });
    expect(m.createMany).toHaveBeenCalledTimes(1);
    // The caller's probe: id + org + not deleted AND the leader's team fragment.
    expect(m.probes[0]).toEqual({
      AND: [{ id: OWN_DRAFT }, { organizationId: ORG_ID }, { deletedAt: null }, teamFragment(LEADER_ID)],
    });
  });

  it('a draft outside their scope is NOT_FOUND and nothing is written', async () => {
    await expect(
      (await asLeader()).vacancy.submitForApproval({ id: OTHER_DRAFT, approverIds: [HR_ID] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(m.txUpdateMany).not.toHaveBeenCalled();
    expect(m.createMany).not.toHaveBeenCalled();
  });

  it('withdrawApproval on their own pending request succeeds; another vacancy is NOT_FOUND', async () => {
    const leader = await asLeader();
    await expect(leader.vacancy.withdrawApproval({ id: OWN_DRAFT, approvalId: APPROVAL_ID })).resolves.toMatchObject({
      id: OWN_DRAFT,
    });
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    await expect(leader.vacancy.withdrawApproval({ id: OTHER_DRAFT, approvalId: APPROVAL_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(m.txUpdateMany).toHaveBeenCalledTimes(1);
  });
});
