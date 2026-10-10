import { describe, it, expect, vi, beforeEach } from 'vitest';

// #312: the consent repository's org-wide withdrawn set and the bounded-chunk lookup.
const { queryRaw, candFindMany, consentFindMany } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  candFindMany: vi.fn(),
  consentFindMany: vi.fn(),
}));
vi.mock('@tims/db', () => ({
  db: {
    $queryRaw: queryRaw,
    candidate: { findMany: candFindMany },
    dataConsent: { findMany: consentFindMany },
  },
}));

import { candidateConsentRepository } from '../../packages/api/src/repositories/candidate-consent.repository';

beforeEach(() => vi.clearAllMocks());

describe('candidateConsentRepository.visibleFitScoreWhere', () => {
  it('returns a notIn filter over every withdrawn id of the org', async () => {
    queryRaw.mockResolvedValue([{ id: 'c-1' }, { id: 'c-1-variant' }]);
    expect(await candidateConsentRepository.visibleFitScoreWhere('org-1')).toEqual({
      candidateId: { notIn: ['c-1', 'c-1-variant'] },
    });
    // org-scoped, exact equality on lower(btrim(email)), never LIKE
    const sql = (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/lower\(btrim\(c\.email\)\) IN/);
    expect(sql).not.toMatch(/LIKE/i);
    expect(queryRaw.mock.calls[0]).toContain('org-1');
  });

  it('returns {} (no restriction) when nobody in the org withdrew', async () => {
    queryRaw.mockResolvedValue([]);
    expect(await candidateConsentRepository.visibleFitScoreWhere('org-1')).toEqual({});
  });
});

describe('candidateConsentRepository.withdrawnCandidateIds — more than 500 ids', () => {
  it('checks every id in bounded chunks instead of truncating (fail-closed)', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `c-${i}`);
    candFindMany.mockImplementation(async (args: { where: { id?: { in: string[] } } }) =>
      (args.where.id?.in ?? []).map((id) => ({ id, email: '' })),
    );
    consentFindMany.mockImplementation(async (args: { where: { subjectUserId: { in: string[] } } }) =>
      args.where.subjectUserId.in.includes('c-500') ? [{ subjectUserId: 'c-500' }] : [],
    );

    const result = await candidateConsentRepository.withdrawnCandidateIds('org-1', ids);

    expect([...result]).toEqual(['c-500']);
    expect(consentFindMany).toHaveBeenCalledTimes(2);
  });
});
