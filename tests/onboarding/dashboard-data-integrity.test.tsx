import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { OnboardingTable, type OnboardingPlan } from '../../apps/web/app/(admin)/people/onboarding/onboarding-table';
import { PendingTasks } from '../../apps/web/app/(admin)/people/onboarding/onboarding-panels';

const plan: OnboardingPlan = {
  id: 'plan-1',
  status: 'active',
  phase: 'day61_90',
  riskScore: 0,
  startDate: '2025-01-01',
  completedAt: null,
  user: { id: 'user-1', firstName: 'Beta', lastName: 'Tester', avatar: null },
  buddy: null,
  tasks: [],
  checkIns: [],
};

describe('Onboarding dashboard data integrity', () => {
  it('does not mark elapsed check-in milestones complete without a persisted check-in', () => {
    const { rerender } = render(
      <I18nProvider>
        <OnboardingTable plans={[plan]} isLoading={false} onPhaseChange={() => {}} />
      </I18nProvider>,
    );
    const checkInCell = screen.getByText('Beta Tester').closest('tr')!.querySelectorAll('td')[6];
    expect(checkInCell).toHaveTextContent('—');
    expect(checkInCell).not.toHaveTextContent('✓');

    rerender(
      <I18nProvider>
        <OnboardingTable
          plans={[
            {
              ...plan,
              checkIns: [
                {
                  id: 'check-1',
                  type: 'day30',
                  status: 'completed',
                  scheduledDate: '2025-01-31',
                  completedAt: '2025-01-31',
                },
              ],
            },
          ]}
          isLoading={false}
          onPhaseChange={() => {}}
        />
      </I18nProvider>,
    );
    const updatedCell = screen.getByText('Beta Tester').closest('tr')!.querySelectorAll('td')[6];
    expect(within(updatedCell).getByText(/Dia 30 ✓/)).toBeInTheDocument();
    expect(updatedCell).not.toHaveTextContent('Dia 1');

    rerender(
      <I18nProvider>
        <OnboardingTable
          plans={[
            {
              ...plan,
              checkIns: [
                { id: 'check-2', type: 'day30', status: 'pending', scheduledDate: '2099-01-31', completedAt: null },
              ],
            },
          ]}
          isLoading={false}
          onPhaseChange={() => {}}
        />
      </I18nProvider>,
    );
    const pendingCell = screen.getByText('Beta Tester').closest('tr')!.querySelectorAll('td')[6];
    expect(within(pendingCell).getByText('Dia 30 Pendiente')).toBeInTheDocument();
  });

  it('counts incomplete tasks as tasks, not documents', () => {
    render(
      <I18nProvider>
        <PendingTasks
          plans={[
            {
              ...plan,
              tasks: [{ id: 'task-1', title: 'Set up account', completed: false, responsible: 'IT', phase: 'day1_30' }],
            },
          ]}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Tareas pendientes')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Documentos Pendientes')).not.toBeInTheDocument();
  });
});
