import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tims/db', () => ({
  tenantDb: {
    vacancy: { findFirst: vi.fn() },
    candidate: { findFirst: vi.fn() },
    application: { findFirst: vi.fn() },
    interview: { findFirst: vi.fn() },
    offer: { findFirst: vi.fn() },
    assessmentAssignment: { findFirst: vi.fn() },
  },
}));

import { assertScoped } from '../../packages/api/src/access/scoped-probe';
import { tenantDb } from '@tims/db';
import type { AccessContext } from '../../packages/api/src/access';

const anchors = {
  teamMemberIds: vi.fn(async () => ['me']),
  unitIds: vi.fn(async () => ['bu1']),
  panelInterviewIds: vi.fn(async () => []),
  ledTeamIds: vi.fn(async () => ['t1']),
};
const ACCESS = { allowed: true, scope: 'team', roles: ['leader'], anchors } as unknown as AccessContext;
beforeEach(() => {
  vi.mocked(tenantDb.vacancy.findFirst).mockReset();
  vi.mocked(tenantDb.interview.findFirst).mockReset();
});

describe('assertScoped', () => {
  it('passes when a row matches AND[{id},{organizationId},{deletedAt:null},scopeFragment] for vacancy', async () => {
    vi.mocked(tenantDb.vacancy.findFirst).mockResolvedValue({ id: 'v1' } as never);
    await expect(assertScoped('vacancy', 'v1', ACCESS, 'me', 'org-1')).resolves.toBeUndefined();
    expect(tenantDb.vacancy.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: 'v1' },
          { organizationId: 'org-1' },
          { deletedAt: null },
          { OR: [{ teamId: { in: ['t1'] } }, { assignedTo: 'me' }] },
        ],
      },
      select: { id: true },
    });
  });

  it('throws NOT_FOUND when no row matches (out-of-scope id-guessing)', async () => {
    vi.mocked(tenantDb.vacancy.findFirst).mockResolvedValue(null as never);
    await expect(assertScoped('vacancy', 'v2', ACCESS, 'me', 'org-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('org scope still org-checks by id with soft-delete guard (fragment {} does not skip the probe)', async () => {
    const orgAccess = { ...ACCESS, scope: 'organization' } as unknown as AccessContext;
    vi.mocked(tenantDb.vacancy.findFirst).mockResolvedValue(null as never);
    await expect(assertScoped('vacancy', 'v9', orgAccess, 'me', 'org-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(tenantDb.vacancy.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 'v9' }, { organizationId: 'org-1' }, { deletedAt: null }, {}] },
      select: { id: true },
    });
  });

  it('soft-delete guard applies ONLY to soft-deletable entities (vacancy, candidate)', async () => {
    vi.mocked(tenantDb.interview.findFirst).mockResolvedValue({ id: 'i1' } as never);
    await assertScoped('interview', 'i1', ACCESS, 'me', 'org-1');
    expect(tenantDb.interview.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.not.arrayContaining([{ deletedAt: null }]),
        }),
      }),
    );
  });

  it('NOT_FOUND message is entity-specific (frontend-observable)', async () => {
    vi.mocked(tenantDb.vacancy.findFirst).mockResolvedValue(null as never);
    await expect(assertScoped('vacancy', 'vx', ACCESS, 'me', 'org-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Vacante no encontrada',
    });
  });
});
