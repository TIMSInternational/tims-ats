import { describe, expect, it } from 'vitest';
import { computeOfferKpis } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-kpi-data';

describe('offer KPIs', () => {
  it('does not invent an accepted salary or acceptance rate from drafts', () => {
    const kpis = computeOfferKpis(
      [
        { status: 'draft', salary: 1, currency: 'COP' },
        { status: 'approved', salary: 2, currency: 'COP' },
      ],
      2,
    );

    expect(kpis).toMatchObject({
      activeCount: 1,
      acceptanceRate: null,
      avgSalary: null,
      pendingApprovals: 0,
      complete: true,
    });
  });

  it('uses only accepted offers for average salary', () => {
    const kpis = computeOfferKpis(
      [
        { status: 'accepted', salary: 100, currency: 'COP' },
        { status: 'accepted', salary: 300, currency: 'COP' },
        { status: 'declined', salary: 10_000, currency: 'COP' },
        { status: 'sent', salary: 10_000, currency: 'COP' },
      ],
      4,
    );

    expect(kpis).toMatchObject({
      activeCount: 1,
      acceptanceRate: 50,
      avgSalary: 200,
      avgSalaryCurrency: 'COP',
      complete: true,
    });
  });

  it('does not combine salaries across currencies', () => {
    const kpis = computeOfferKpis(
      [
        { status: 'accepted', salary: 100, currency: 'COP' },
        { status: 'accepted', salary: 100, currency: 'USD' },
      ],
      2,
    );

    expect(kpis.avgSalary).toBeNull();
    expect(kpis.avgSalaryCurrency).toBeNull();
  });

  it('groups currencies case- and whitespace-insensitively', () => {
    const kpis = computeOfferKpis(
      [
        { status: 'accepted', salary: 90_000_000, currency: 'cop' },
        { status: 'accepted', salary: 96_000_000, currency: ' COP' },
        { status: 'accepted', salary: 102_000_000, currency: 'COP' },
      ],
      3,
    );

    expect(kpis).toMatchObject({ avgSalary: 96_000_000, avgSalaryCurrency: 'COP' });
  });

  it('does not present a partial first page as organization-wide metrics', () => {
    const kpis = computeOfferKpis([{ status: 'accepted', salary: 100, currency: 'USD' }], 101);

    expect(kpis).toMatchObject({
      activeCount: null,
      acceptanceRate: null,
      avgSalary: null,
      pendingApprovals: null,
      complete: false,
    });
  });
  // recruiter-data-78: convertToEmployee moves an accepted offer to 'converted'. A converted offer is a hire,
  // so it must keep counting as accepted for every KPI, and completing the hire must not lower the metrics.
  describe('converted offers count as accepted (recruiter-data-78)', () => {
    it('counts a converted offer as accepted in the acceptance rate', () => {
      const kpis = computeOfferKpis(
        [
          { status: 'accepted', salary: 100, currency: 'COP' },
          { status: 'converted', salary: 100, currency: 'COP' },
          { status: 'declined', salary: 100, currency: 'COP' },
        ],
        3,
      );

      expect(kpis.acceptanceRate).toBe(67);
    });

    it('does not lower the acceptance rate when an accepted offer is converted', () => {
      const before = computeOfferKpis(
        [
          { status: 'accepted', salary: 100, currency: 'COP' },
          { status: 'declined', salary: 100, currency: 'COP' },
        ],
        2,
      );
      const after = computeOfferKpis(
        [
          { status: 'converted', salary: 100, currency: 'COP' },
          { status: 'declined', salary: 100, currency: 'COP' },
        ],
        2,
      );

      expect(before.acceptanceRate).toBe(50);
      expect(after.acceptanceRate).toBe(before.acceptanceRate);
    });

    it('averages accepted and converted salaries together', () => {
      const kpis = computeOfferKpis(
        [
          { status: 'accepted', salary: 100, currency: 'COP' },
          { status: 'converted', salary: 300, currency: 'COP' },
          { status: 'declined', salary: 10_000, currency: 'COP' },
        ],
        3,
      );

      expect(kpis).toMatchObject({ avgSalary: 200, avgSalaryCurrency: 'COP' });
    });

    it('does not count a converted offer as active', () => {
      const kpis = computeOfferKpis(
        [
          { status: 'converted', salary: 100, currency: 'COP' },
          { status: 'sent', salary: 100, currency: 'COP' },
        ],
        2,
      );

      expect(kpis.activeCount).toBe(1);
    });
  });
});
