import { beforeEach, describe, expect, it, vi } from 'vitest';

// The data access behind the offer draft rules and the hire guard (Pilot UX audit B-04, F-15, company-admin
// data-62): every query is tenant-scoped by organizationId, and the draft edit is a compare-and-set on 'draft'.

const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VAC = '33333333-3333-4333-8333-333333333333';
const OFFER = '99999999-9999-4999-8999-999999999999';

const mockDb = vi.hoisted(() => ({
  organization: { findFirst: vi.fn() },
  vacancy: { findFirst: vi.fn() },
  offer: { count: vi.fn(), updateMany: vi.fn(), findFirstOrThrow: vi.fn() },
}));

vi.mock('@tims/db', () => ({ tenantDb: mockDb }));

import { vacancyHireRepository } from '../../packages/api/src/repositories/vacancy-hire.repository';
import { OFFER_EDIT_SELECT, offerDraftRepository } from '../../packages/api/src/repositories/offer-draft.repository';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vacancyHireRepository.counts (hire pre-check)', () => {
  it('reads the vacancy in this organization and counts its converted offers', async () => {
    mockDb.vacancy.findFirst.mockResolvedValue({ positions: 2 });
    mockDb.offer.count.mockResolvedValue(1);
    await expect(vacancyHireRepository.counts(ORG, VAC)).resolves.toEqual({ positions: 2, hires: 1 });
    expect(mockDb.vacancy.findFirst).toHaveBeenCalledWith({
      where: { id: VAC, organizationId: ORG },
      select: { positions: true },
    });
    expect(mockDb.offer.count).toHaveBeenCalledWith({
      where: { vacancyId: VAC, organizationId: ORG, status: 'converted' },
    });
  });

  it('is null, without counting, for a vacancy outside the organization', async () => {
    mockDb.vacancy.findFirst.mockResolvedValue(null);
    await expect(vacancyHireRepository.counts(ORG, VAC)).resolves.toBeNull();
    expect(mockDb.offer.count).not.toHaveBeenCalled();
  });
});

describe('offerDraftRepository', () => {
  it('currency sources: the organization settings and the vacancy company currency, org-scoped', async () => {
    mockDb.organization.findFirst.mockResolvedValue({ settings: { currency: 'CRC' } });
    mockDb.vacancy.findFirst.mockResolvedValue({ company: { currency: 'USD' } });
    await expect(offerDraftRepository.currencySources(ORG, VAC)).resolves.toEqual({
      orgSettings: { currency: 'CRC' },
      companyCurrency: 'USD',
    });
    expect(mockDb.vacancy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VAC, organizationId: ORG } }),
    );
  });

  it('currency sources are null-safe when neither row is found', async () => {
    mockDb.organization.findFirst.mockResolvedValue(null);
    mockDb.vacancy.findFirst.mockResolvedValue(null);
    await expect(offerDraftRepository.currencySources(ORG, VAC)).resolves.toEqual({
      orgSettings: null,
      companyCurrency: null,
    });
  });

  it('draft edit is a compare-and-set on status draft and reports whether it applied', async () => {
    mockDb.offer.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(offerDraftRepository.updateDraft(ORG, OFFER, { salary: 1000 })).resolves.toBe(true);
    await expect(offerDraftRepository.updateDraft(ORG, OFFER, { salary: 1000 })).resolves.toBe(false);
    expect(mockDb.offer.updateMany).toHaveBeenCalledWith({
      where: { id: OFFER, organizationId: ORG, status: 'draft' },
      data: { salary: 1000 },
    });
  });

  it('an edit of the pay is also a compare-and-set on the salary and currency it was computed from', async () => {
    mockDb.offer.updateMany.mockResolvedValueOnce({ count: 1 });
    await offerDraftRepository.updateDraft(ORG, OFFER, { currency: 'CRC' }, { salary: 12_000, currency: 'USD' });
    expect(mockDb.offer.updateMany).toHaveBeenCalledWith({
      where: { id: OFFER, organizationId: ORG, status: 'draft', salary: 12_000, currency: 'USD' },
      data: { currency: 'CRC' },
    });
  });

  it('reads back the edited terms without settings (the signing token lives there)', async () => {
    mockDb.offer.findFirstOrThrow.mockResolvedValue({ id: OFFER });
    await offerDraftRepository.findEdited(ORG, OFFER);
    expect(mockDb.offer.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: OFFER, organizationId: ORG },
      select: OFFER_EDIT_SELECT,
    });
    expect(OFFER_EDIT_SELECT).not.toHaveProperty('settings');
  });
});
