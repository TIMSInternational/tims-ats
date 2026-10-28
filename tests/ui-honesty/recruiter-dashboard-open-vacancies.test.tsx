import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

const { state, stub } = vi.hoisted(() => ({
  stub: (name: string) => ({ [name]: () => null, [`${name}Skeleton`]: () => null }),
  state: {
  kpis: { isLoading: false, isError: false, data: undefined as { totalOpen: number; totalApplications: number } | undefined },
  },
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    vacancy: {
      getDashboardKpis: { useQuery: () => ({ ...state.kpis, refetch: vi.fn() }) },
      list: { useQuery: () => ({ isLoading: false, isError: false, data: { items: [] }, refetch: vi.fn() }) },
    },
    candidate: { getDashboardKpis: { useQuery: () => ({ isLoading: false, isError: false, data: undefined }) } },
  },
}));
vi.mock('../../apps/web/components', () => ({
  ErrorState: () => <div data-testid="error-state" />,
}));
vi.mock('../../apps/web/app/(admin)/dashboard/recruiting-kpi-strip', () => stub('RecruitingKpiStrip'));
vi.mock('../../apps/web/app/(admin)/dashboard/pipeline-funnel', () => stub('PipelineFunnel'));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-sla-panel', () => stub('AlertsSlaPanel'));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-pending-panel', () => stub('AlertsPendingPanel'));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-risk-panel', () => stub('AlertsRiskPanel'));
vi.mock('../../apps/web/app/(admin)/dashboard/setup-checklist', () => stub('SetupChecklist'));
vi.mock('../../apps/web/app/(admin)/dashboard/pick-dashboard', () => ({ pickPrimaryDashboard: () => 'recruiter' }));

import { RecruitmentDashboard } from '../../apps/web/app/(admin)/dashboard/recruitment-dashboard';

describe('recruiter dashboard open-vacancies card', () => {
  it('shows the real count when the KPI query succeeds', () => {
    state.kpis = { isLoading: false, isError: false, data: { totalOpen: 5, totalApplications: 0 } };
    render(<RecruitmentDashboard roleSlugs={['recruiter']} />);
    expect(screen.getByTestId('open-vacancies-total').textContent).toBe('5');
  });

  it('shows an error, not a default 0, when the KPI query fails', () => {
    state.kpis = { isLoading: false, isError: true, data: undefined };
    render(<RecruitmentDashboard roleSlugs={['recruiter']} />);
    expect(screen.queryByTestId('open-vacancies-total')).toBeNull();
    expect(screen.getByTestId('error-state')).toBeTruthy();
  });

  it('shows the error state when a refetch fails even though earlier data is cached', () => {
    state.kpis = { isLoading: false, isError: true, data: { totalOpen: 5, totalApplications: 0 } };
    render(<RecruitmentDashboard roleSlugs={['recruiter']} />);
    expect(screen.queryByTestId('open-vacancies-total')).toBeNull();
    expect(screen.getByTestId('error-state')).toBeTruthy();
  });
});
