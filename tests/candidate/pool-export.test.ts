import { describe, it, expect, vi, beforeEach } from 'vitest';

const candidateFindMany = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    candidate: {
      findMany: (...args: unknown[]) => candidateFindMany(...args),
    },
  },
}));

import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

describe('candidateRepository.findForExport', () => {
  beforeEach(() => {
    candidateFindMany.mockReset();
    candidateFindMany.mockResolvedValue([]);
  });

  it('composes organizationId, deletedAt: null, and scopeWhere via AND (never spread)', async () => {
    const scopeWhere = { __marker: 'scope-fragment' };
    await candidateRepository.findForExport('org-1', scopeWhere as never, {}, 5000);

    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ organizationId: 'org-1', deletedAt: null });
    expect(call.where.AND).toContainEqual(scopeWhere);
  });

  it('adds a poolType filter clause only when provided', async () => {
    await candidateRepository.findForExport('org-1', {} as never, { poolType: 'active' }, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ poolType: 'active' });
  });

  it('adds a tags filter clause only when provided', async () => {
    await candidateRepository.findForExport('org-1', {} as never, { tags: ['vip'] }, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ tags: { some: { tag: { in: ['vip'] } } } });
  });

  it('requests one extra row beyond the limit (truncation detection)', async () => {
    await candidateRepository.findForExport('org-1', {} as never, {}, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.take).toBe(5001);
  });

  it('selects only the export columns (no full-record leak)', async () => {
    await candidateRepository.findForExport('org-1', {} as never, {}, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.select).toEqual({
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      poolType: true,
      currentTitle: true,
      currentCompany: true,
      yearsExperience: true,
      location: true,
      tags: { select: { tag: true } },
      createdAt: true,
    });
  });
});
