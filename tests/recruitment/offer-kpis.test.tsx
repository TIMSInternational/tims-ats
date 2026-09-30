import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { OfferKpis } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-kpis';

type KpiProps = Parameters<typeof OfferKpis>[0];

function renderKpis(props: Partial<KpiProps>) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <OfferKpis
        activeCount={null}
        acceptanceRate={null}
        avgSalary={null}
        avgSalaryCurrency={null}
        pendingApprovals={null}
        complete={false}
        loading={false}
        isError={false}
        {...props}
      />
    </I18nProvider>,
  );
}

function card(label: string) {
  const el = screen.getByText(label).parentElement?.parentElement;
  if (!el) throw new Error(`KPI card ${label} not found`);
  return el;
}

describe('OfferKpis', () => {
  it('renders the localized not-available value and the incomplete subtitle on every card', () => {
    renderKpis({});

    for (const label of [en.offers.kpiActive, en.offers.kpiAcceptance, en.offers.kpiAvgSalary, en.offers.kpiPending]) {
      expect(card(label)).toHaveTextContent(en.offers.notAvailable);
      expect(card(label)).toHaveTextContent(en.offers.kpiIncomplete);
    }
    expect(screen.queryByText('N/D')).not.toBeInTheDocument();
  });

  it('renders measured values with visibility-qualified subtitles when complete', () => {
    renderKpis({
      activeCount: 2,
      acceptanceRate: 50,
      avgSalary: 1000,
      avgSalaryCurrency: 'USD',
      pendingApprovals: 1,
      complete: true,
    });

    expect(card(en.offers.kpiActive)).toHaveTextContent('2');
    expect(card(en.offers.kpiActive)).toHaveTextContent(en.offers.activeOffers);
    expect(card(en.offers.kpiAcceptance)).toHaveTextContent('50%');
    expect(card(en.offers.kpiAcceptance)).toHaveTextContent(en.offers.ofSentOrResolved);
    expect(card(en.offers.kpiAvgSalary)).toHaveTextContent(new RegExp(`USD\\s1\\.000 / ${en.offers.perYear}`));
    expect(card(en.offers.kpiAvgSalary)).toHaveTextContent(en.offers.avgOfAccepted);
    expect(card(en.offers.kpiPending)).toHaveTextContent('1');
    expect(card(en.offers.kpiPending)).toHaveTextContent(en.offers.pendingYourApproval);
    expect(screen.queryByText(en.offers.kpiIncomplete)).not.toBeInTheDocument();
  });

  it('shows not-available for the average when accepted offers mix currencies', () => {
    renderKpis({ activeCount: 0, acceptanceRate: 100, avgSalary: null, avgSalaryCurrency: null, pendingApprovals: 0, complete: true });

    expect(card(en.offers.kpiAvgSalary)).toHaveTextContent(en.offers.notAvailable);
    expect(card(en.offers.kpiAvgSalary)).toHaveTextContent(en.offers.avgOfAccepted);
  });
});
