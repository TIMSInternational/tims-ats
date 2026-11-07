import { describe, it, expect, vi, beforeEach } from 'vitest';

// #312: the consent repository's org-wide withdrawn set and the bounded-chunk lookup.
const { queryRaw, candFindMany, consentFindMany, evidenceFindFirst } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  candFindMany: vi.fn(),
  consentFindMany: vi.fn(),
  evidenceFindFirst: vi.fn(),
}));
vi.mock('@tims/db', () => ({
  db: {
    $queryRaw: queryRaw,
    candidate: { findMany: candFindMany },
    dataConsent: { findMany: consentFindMany },
    applicationConsentEvidence: { findFirst: evidenceFindFirst },
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

// Candidate emails follow the language the candidate applied in: the consent evidence's locale.
describe('candidateConsentRepository.consentLocale', () => {
  const where = (call: number) => (evidenceFindFirst.mock.calls[call]?.[0] as { where: Record<string, unknown> }).where;

  it("uses that application's evidence first, org-scoped, selecting only the locale", async () => {
    evidenceFindFirst.mockResolvedValueOnce({ locale: 'en' });
    expect(await candidateConsentRepository.consentLocale('org-1', { applicationId: 'app-1', candidateId: 'c-1' })).toBe('en');
    expect(evidenceFindFirst).toHaveBeenCalledTimes(1);
    expect(where(0)).toMatchObject({ organizationId: 'org-1', applicationId: 'app-1', locale: { not: null } });
    expect((evidenceFindFirst.mock.calls[0]?.[0] as { select: unknown }).select).toEqual({ locale: true });
  });

  it("falls back to the candidate's most recent evidence (a staff-added application has none)", async () => {
    evidenceFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ locale: 'en' });
    expect(await candidateConsentRepository.consentLocale('org-1', { applicationId: 'app-2', candidateId: 'c-1' })).toBe('en');
    expect(where(1)).toMatchObject({ organizationId: 'org-1', candidateId: 'c-1' });
    expect((evidenceFindFirst.mock.calls[1]?.[0] as { orderBy: unknown }).orderBy).toEqual({ agreedAt: 'desc' });
  });

  it('is null when there is no evidence, and never throws (a language must never block an email)', async () => {
    evidenceFindFirst.mockResolvedValue(null);
    expect(await candidateConsentRepository.consentLocale('org-1', { candidateId: 'c-1' })).toBeNull();
    evidenceFindFirst.mockRejectedValue(new Error('relation does not exist'));
    expect(await candidateConsentRepository.consentLocale('org-1', { applicationId: 'a', candidateId: 'c-1' })).toBeNull();
  });
});
