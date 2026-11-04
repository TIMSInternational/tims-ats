import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// A-18 / D-10: the SLA and risk panels silently covered only the FIRST published vacancy, the risk rows
// were labelled "Acción sugerida IA" although they are a fixed rule, and the landing had no quick actions.

const { seen, perms } = vi.hoisted(() => ({
  seen: { sla: [] as Array<string | undefined>, risk: [] as Array<string | undefined> },
  perms: { allowed: new Set<string>() },
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/permissions', () => ({
  useCan: () => (module: string, action = 'read') => perms.allowed.has(`${module}:${action}`),
}));
vi.mock('../../apps/web/lib/platform-api/tenant-invitations', () => ({ isTenantInvitationsEnabled: () => true }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    vacancy: {
      getDashboardKpis: { useQuery: () => ({ isLoading: false, isError: false, data: { totalOpen: 2 }, refetch: vi.fn() }) },
      list: {
        useQuery: (input: { status: string }) => ({
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
          data: {
            items:
              input.status === 'published'
                ? [
                    { id: 'vac-1', title: 'Analista Financiero' },
                    { id: 'vac-2', title: 'Arquitecta' },
                  ]
                : [],
          },
        }),
      },
    },
    candidate: { getDashboardKpis: { useQuery: () => ({ isLoading: false, isError: false, data: undefined }) } },
  },
}));
vi.mock('../../apps/web/components', () => ({ ErrorState: () => <div data-testid="error-state" /> }));
vi.mock('../../apps/web/app/(admin)/dashboard/recruiting-kpi-strip', () => ({ RecruitingKpiStrip: () => null }));
vi.mock('../../apps/web/app/(admin)/dashboard/pipeline-funnel', () => ({
  PipelineFunnel: () => null,
  PipelineFunnelSkeleton: () => null,
}));
vi.mock('../../apps/web/app/(admin)/dashboard/open-vacancies-card', () => ({
  OpenVacanciesCard: () => null,
  OpenVacanciesCardSkeleton: () => null,
}));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-sla-panel', () => ({
  AlertsSlaPanel: ({ vacancyId }: { vacancyId: string | undefined }) => {
    seen.sla.push(vacancyId);
    return null;
  },
}));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-risk-panel', () => ({
  AlertsRiskPanel: ({ vacancyId }: { vacancyId: string | undefined }) => {
    seen.risk.push(vacancyId);
    return null;
  },
}));
vi.mock('../../apps/web/app/(admin)/dashboard/alerts-pending-panel', () => ({ AlertsPendingPanel: () => null }));
vi.mock('../../apps/web/app/(admin)/dashboard/setup-checklist', () => ({ SetupChecklist: () => null }));
vi.mock('../../apps/web/app/(admin)/dashboard/pick-dashboard', () => ({
  pickPrimaryDashboard: () => 'recruiter',
  showsSetupChecklistFor: () => false,
}));

import { RecruitmentDashboard } from '../../apps/web/app/(admin)/dashboard/recruitment-dashboard';

afterEach(() => {
  cleanup();
  seen.sla.length = 0;
  seen.risk.length = 0;
  perms.allowed = new Set();
});

describe('recruiter landing: alerts scope and quick actions', () => {
  it('names the vacancy the SLA and risk alerts cover, and switching it re-scopes both panels', () => {
    render(<RecruitmentDashboard roleSlugs={['recruiter']} />);
    const select = screen.getByLabelText(es.recruitingDashboard.alertsVacancyLabel) as HTMLSelectElement;
    expect(select.value).toBe('vac-1');
    expect(screen.getByText(es.recruitingDashboard.alertsScopeHint)).toBeTruthy();
    expect(seen.sla.at(-1)).toBe('vac-1');
    expect(seen.risk.at(-1)).toBe('vac-1');

    fireEvent.change(select, { target: { value: 'vac-2' } });
    expect(seen.sla.at(-1)).toBe('vac-2');
    expect(seen.risk.at(-1)).toBe('vac-2');
  });

  it('offers "Nueva vacante" and "Invitar al equipo" only to users who can do them', () => {
    perms.allowed = new Set(['vacancy:create']);
    render(<RecruitmentDashboard roleSlugs={['recruiter']} />);
    const newVacancy = screen.getByText(es.recruitingDashboard.quickNewVacancy).closest('a');
    expect(newVacancy?.getAttribute('href')).toBe('/recruitment/vacancies?create=1');
    expect(screen.queryByText(es.recruitingDashboard.quickInviteTeam)).toBeNull();
    cleanup();

    perms.allowed = new Set(['vacancy:create', 'user:create']);
    render(<RecruitmentDashboard roleSlugs={['super_admin']} />);
    expect(screen.getByText(es.recruitingDashboard.quickInviteTeam).closest('a')?.getAttribute('href')).toBe('/settings/users');
  });

  it('labels the rule-based suggestion as a next step, not as AI', () => {
    expect(es.recruitingDashboard.aiSuggestion).toBe('Siguiente paso');
    expect(es.pipeline.iaReviewUrgent).not.toMatch(/^IA/);
    expect(es.pipeline.iaAdvanceHighFit).not.toMatch(/^IA/);
  });
});
