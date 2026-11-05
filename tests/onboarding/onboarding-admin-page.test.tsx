import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { OnboardingPlan } from '../../apps/web/app/(admin)/people/onboarding/onboarding-table';

// B-08 / B-09 / E-08 / B-22 / B-23 / E-09 on the HR onboarding page.

const state = vi.hoisted(() => ({
  grants: new Set<string>(),
  privileged: false,
  sessionPermissions: [] as Array<{ module: string; action: string; scope: string }>,
  plans: [] as unknown[],
  queries: [] as Array<{ path: string; input: unknown; enabled: boolean }>,
  mutate: vi.fn(),
  hasMore: false,
  fetchNextPage: vi.fn(),
}));

vi.mock('../../apps/web/lib/permissions', () => ({
  useCan:
    () =>
    (module: string, action = 'read') =>
      state.privileged || state.grants.has(`${module}:${action}`),
  usePermissions: () => ({
    isPrivileged: state.privileged,
    isLoading: false,
    roles: [],
    roleLabel: '',
    userId: 'me',
    can: () => true,
  }),
}));

vi.mock('../../apps/web/lib/trpc', () => {
  const invalidate = () => Promise.resolve();
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        const key = path.join('.');
        if (prop === 'useQuery')
          return (input?: unknown, opts?: { enabled?: boolean }) => {
            state.queries.push({ path: key, input, enabled: opts?.enabled !== false });
            if (key === 'auth.getSessionInfo')
              return { data: { permissions: state.sessionPermissions }, isLoading: false, isError: false };
            if (key === 'onboarding.list')
              return { data: { plans: state.plans }, isLoading: false, isError: false, refetch: () => undefined };
            if (key === 'onboarding.getDashboardKpis')
              return {
                data: {
                  activePlans: 1,
                  totalTasks: 12,
                  completedTasks: 2,
                  taskCompletionRate: 17,
                  overdueCheckIns: 0,
                  overdueTasks: 3,
                },
                isLoading: false,
                isError: false,
                refetch: () => undefined,
              };
            return { data: undefined, isLoading: false, isError: false, refetch: () => undefined };
          };
        if (prop === 'useInfiniteQuery')
          return (input?: unknown) => {
            state.queries.push({ path: key, input, enabled: true });
            return {
              data: { pages: [{ plans: state.plans, nextCursor: state.hasMore ? 'next' : null }] },
              isLoading: false,
              isError: false,
              hasNextPage: state.hasMore,
              isFetchingNextPage: false,
              fetchNextPage: state.fetchNextPage,
              refetch: () => undefined,
            };
          };
        if (prop === 'useMutation') return () => ({ mutate: state.mutate, isPending: false });
        if (prop === 'useUtils')
          return () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate }) }) });
        return node([...path, prop]);
      },
    });
  return { trpc: node([]) };
});

// The picker talks to the people directory; here it is one button that picks "Bruno Buddy".
vi.mock('../../apps/web/components/user-picker', () => ({
  UserPicker: ({
    onSelect,
  }: {
    onSelect: (id: string, u: { id: string; firstName: string; lastName: string }) => void;
  }) => (
    <button type="button" onClick={() => onSelect('buddy-1', { id: 'buddy-1', firstName: 'Bruno', lastName: 'Buddy' })}>
      pick-buddy
    </button>
  ),
}));

import OnboardingPage from '../../apps/web/app/(admin)/people/onboarding/page';
import { OnboardingTable } from '../../apps/web/app/(admin)/people/onboarding/onboarding-table';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const plan = (over: Partial<OnboardingPlan> = {}): OnboardingPlan => ({
  id: 'plan-1',
  status: 'active',
  phase: 'day1_30',
  riskScore: null,
  startDate: daysAgo(45),
  completedAt: null,
  user: { id: 'hire-1', firstName: 'Ana', lastName: 'Lopez', avatar: null, jobTitle: 'Analista' },
  buddy: null,
  tasks: [
    {
      id: 't1',
      title: 'Firmar contrato y documentos de ingreso',
      completed: false,
      responsible: 'hr',
      phase: 'day1_30',
      dueDate: daysAgo(48),
    },
    {
      id: 't2',
      title: 'Revisión de objetivos de 60 días',
      completed: false,
      responsible: 'manager',
      phase: 'day31_60',
      dueDate: daysAgo(-15),
    },
  ],
  checkIns: [],
  ...over,
});

const LEADER = ['onboarding:read', 'onboarding:update'];
const HR = ['onboarding:read', 'onboarding:create', 'onboarding:update'];

beforeEach(() => {
  cleanup();
  state.queries.length = 0;
  state.mutate.mockReset();
  state.fetchNextPage.mockReset();
  state.hasMore = false;
  state.privileged = false;
  state.plans = [plan()];
});

function renderPage() {
  return render(
    <I18nProvider>
      <OnboardingPage />
    </I18nProvider>,
  );
}

describe('HR onboarding page — who sees what (B-09 / E-08)', () => {
  it('a team-scoped leader gets no KPI request, no KPI strip and no "Nuevo onboarding", but sees the hires', () => {
    state.grants = new Set(LEADER);
    state.sessionPermissions = [{ module: 'onboarding', action: 'read', scope: 'team' }];
    renderPage();
    expect(state.queries.filter((q) => q.path === 'onboarding.getDashboardKpis').every((q) => !q.enabled)).toBe(true);
    expect(screen.queryByText('Tareas vencidas')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nuevo onboarding/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Ana Lopez').length).toBeGreaterThan(0);
  });

  it('an organization-wide reader sees the real KPIs (overdue tasks, not a fake risk score) and can create', () => {
    state.grants = new Set(HR);
    state.sessionPermissions = [{ module: 'onboarding', action: 'read', scope: 'organization' }];
    renderPage();
    expect(state.queries.find((q) => q.path === 'onboarding.getDashboardKpis')?.enabled).toBe(true);
    expect(screen.getByText('Tareas vencidas')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('Riesgo Onboarding')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo onboarding/ })).toBeInTheDocument();
  });

  it('reads "Personas › Onboarding" in Spanish (B-22 / E-09), with no English header text', () => {
    state.grants = new Set(HR);
    state.sessionPermissions = [{ module: 'onboarding', action: 'read', scope: 'organization' }];
    renderPage();
    expect(screen.getByText('Personas')).toBeInTheDocument();
    expect(screen.queryByText('People')).not.toBeInTheDocument();
    expect(screen.queryByText(/Dashboard/)).not.toBeInTheDocument();
    expect(screen.queryByText(/!/)).not.toBeInTheDocument();
  });

  it('asks the server for the phase the start date gives today, before paging (B-23)', () => {
    state.grants = new Set(HR);
    state.sessionPermissions = [{ module: 'onboarding', action: 'read', scope: 'organization' }];
    renderPage();
    const lists = () => state.queries.filter((q) => q.path === 'onboarding.list').map((q) => q.input);
    expect(lists().at(-1)).toEqual({ limit: 50, status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: 'Día 31-60' }));
    expect(lists().at(-1)).toEqual({ limit: 50, status: 'active', startPhase: 'day31_60' });
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(lists().at(-1)).toEqual({ limit: 50, status: 'active' });
  });

  it('keeps every hire reachable: "Cargar más" fetches the next page', () => {
    state.grants = new Set(HR);
    state.sessionPermissions = [{ module: 'onboarding', action: 'read', scope: 'organization' }];
    state.hasMore = true;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});

function renderTable(p: OnboardingPlan) {
  return render(
    <I18nProvider>
      <OnboardingTable plans={[p]} isLoading={false} onPhaseChange={() => {}} />
    </I18nProvider>,
  );
}

describe('onboarding table rows', () => {
  it('lets HR or the hiring leader assign a buddy through onboarding.updatePlan (B-08)', () => {
    state.grants = new Set(LEADER);
    renderTable(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Asignar compañero guía: Ana Lopez' }));
    expect(screen.getByText('Compañero guía de Ana Lopez')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pick-buddy' }));
    expect(state.mutate).toHaveBeenCalledWith({ id: 'plan-1', buddyId: 'buddy-1' });
  });

  it('shows the buddy in Spanish and offers no control to a viewer who cannot update', () => {
    state.grants = new Set(['onboarding:read']);
    renderTable(plan({ buddy: { id: 'b', firstName: 'Bruno', lastName: 'Buddy', avatar: null } }));
    expect(screen.getByText(/Compañero guía: Bruno B\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cambiar/ })).not.toBeInTheDocument();
    cleanup();
    renderTable(plan());
    expect(screen.getByText('Sin compañero guía')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Asignar/ })).not.toBeInTheDocument();
  });

  it('derives the phase badge, hides a risk dot no one computed, and flags overdue tasks (B-23)', () => {
    state.grants = new Set(LEADER);
    renderTable(plan());
    const row = screen.getByText('Ana Lopez').closest('tr')!;
    expect(within(row).getByText('Día 31-60')).toBeInTheDocument();
    expect(within(row).getByText('Sin cálculo de riesgo')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Ver tareas' }));
    const contract = screen.getByRole('checkbox', { name: 'Firmar contrato y documentos de ingreso' }).closest('td')!;
    expect(within(contract).getByText('Vencida')).toBeInTheDocument();
    const later = screen.getByRole('checkbox', { name: 'Revisión de objetivos de 60 días' }).closest('td')!;
    expect(within(later).queryByText('Vencida')).not.toBeInTheDocument();
    // The leader cannot create tasks (no onboarding:create), so the link is not offered.
    expect(screen.queryByRole('button', { name: 'Agregar tarea' })).not.toBeInTheDocument();
  });
});
