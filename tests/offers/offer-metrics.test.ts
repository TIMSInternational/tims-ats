import { describe, expect, it } from 'vitest';
import { summarizeVisibleOffers } from '../../apps/web/app/(admin)/recruitment/offers/offer-metrics';

describe('visible offer metrics', () => {
  it('does not call a draft or approved offer an accepted salary', () => {
    expect(summarizeVisibleOffers([
      { status: 'approved', salary: 120000, currency: 'USD' },
    ])).toMatchObject({ activeCount: 1, acceptanceRate: 0, avgSalary: null });
  });

  it('averages only accepted offers of the same currency', () => {
    expect(summarizeVisibleOffers([
      { status: 'approved', salary: 900000, currency: 'USD' },
      { status: 'accepted', salary: 100000, currency: 'USD' },
      { status: 'accepted', salary: 200000, currency: 'USD' },
    ])).toMatchObject({ acceptanceRate: 100, avgSalary: 150000, avgSalaryCurrency: 'USD' });
  });

  it('does not combine salaries across currencies', () => {
    expect(summarizeVisibleOffers([
      { status: 'accepted', salary: 100000, currency: 'USD' },
      { status: 'accepted', salary: 100000, currency: 'COP' },
    ])).toMatchObject({ avgSalary: null, avgSalaryCurrency: null });
  });
});
