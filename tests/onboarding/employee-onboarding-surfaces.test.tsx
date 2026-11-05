import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';

// B-25 (home card), B-24 ("Mi Onboarding"), E-09 (Spanish buddy/manager words) and B-07 (what the hire
// screen says was sent to the new employee).

const state = vi.hoisted(() => ({
  listInput: undefined as unknown,
  plans: [] as unknown[],
}));

vi.mock('../../apps/web/lib/trpc', () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'useQuery')
          return (input?: unknown) => {
            if (path.join('.') === 'onboarding.list') state.listInput = input;
            return { data: { plans: state.plans }, isLoading: false, isError: false };
          };
        if (prop === 'useMutation') return () => ({ mutate: vi.fn(), isPending: false });
        if (prop === 'useUtils')
          return () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn() }) }) });
        return node([...path, prop]);
      },
    });
  return { trpc: node([]) };
});

import { EmployeeOnboardingCard } from '../../apps/web/app/(admin)/dashboard/employee-onboarding-card';
import { MyTaskList } from '../../apps/web/app/(admin)/my-onboarding/my-task-list';
import { MyCheckInList } from '../../apps/web/app/(admin)/my-onboarding/my-check-in-list';
import { MyPlanSummary } from '../../apps/web/app/(admin)/my-onboarding/my-plan-summary';
import { HireAccessNotice } from '../../apps/web/app/(admin)/recruitment/offers/_components/hire-access-notice';

const daysFromToday = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

const es = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

beforeEach(() => {
  cleanup();
  state.listInput = undefined;
  state.plans = [];
});

describe('employee home card (B-25)', () => {
  it('asks only for the caller’s own plan (mine: true), links to Mi Onboarding and previews the next tasks', () => {
    state.plans = [
      {
        id: 'p1',
        startDate: daysFromToday(-3),
        tasks: [
          {
            id: 'a',
            title: 'Leer y aceptar las políticas de la empresa',
            completed: false,
            dueDate: daysFromToday(-1),
          },
          { id: 'b', title: 'Inscripción en nómina y beneficios', completed: false, dueDate: daysFromToday(2) },
          { id: 'c', title: 'Firmar contrato y documentos de ingreso', completed: true, dueDate: daysFromToday(-6) },
          { id: 'd', title: 'Definir objetivos de 30/60/90 días', completed: false, dueDate: daysFromToday(4) },
          { id: 'e', title: 'Revisión de objetivos de 30 días', completed: false, dueDate: daysFromToday(27) },
        ],
      },
    ];
    es(<EmployeeOnboardingCard />);
    expect(state.listInput).toEqual({ limit: 1, status: 'active', mine: true });
    expect(screen.getByRole('link', { name: 'Ver mi onboarding' })).toHaveAttribute('href', '/my-onboarding');
    expect(screen.getByText(/^Fecha de inicio:/)).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/Leer y aceptar las políticas/);
    expect(items[0]).toMatch(/Vencida/);
    expect(items[2]).toMatch(/Definir objetivos/);
    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('keeps the empty state when the caller has no plan', () => {
    es(<EmployeeOnboardingCard />);
    expect(screen.getByText('No tienes un plan de onboarding activo')).toBeInTheDocument();
  });
});

describe('Mi Onboarding (B-24 / E-09)', () => {
  it('orders tasks by due date, flags the overdue one and shows what each task means', () => {
    es(
      <MyTaskList
        tasks={[
          {
            id: 'late',
            title: 'Revisión de 30 días',
            responsible: 'manager',
            dueDate: daysFromToday(20),
            completed: false,
          },
          {
            id: 'mine',
            title: 'Leer y aceptar las políticas de la empresa',
            description: 'Léelas y marca esta tarea cuando termines.',
            responsible: 'employee',
            dueDate: daysFromToday(-2),
            completed: false,
          },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Leer y aceptar las políticas de la empresa');
    expect(within(items[0]!).getByText('Vencida')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Léelas y marca esta tarea cuando termines.')).toBeInTheDocument();
    expect(within(items[1]!).queryByText('Vencida')).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent('Responsable: Jefatura');
  });

  it('says "Vencido" for a past check-in that nobody completed', () => {
    es(
      <MyCheckInList
        checkIns={[
          { id: 'c1', type: 'day1', scheduledDate: daysFromToday(-5), status: 'pending' },
          { id: 'c2', type: 'day30', scheduledDate: daysFromToday(25), status: 'pending' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Vencido')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Pendiente')).toBeInTheDocument();
  });

  it('names the buddy in Spanish and derives the phase from the start date', () => {
    es(
      <MyPlanSummary
        jobTitle="Analista"
        startDate={daysFromToday(-45)}
        status="active"
        phase="day1_30"
        progress={40}
        buddy={null}
      />,
    );
    expect(screen.getByText('Mi compañero guía')).toBeInTheDocument();
    expect(screen.getByText('Aún no tienes un compañero guía asignado')).toBeInTheDocument();
    expect(screen.getByText('Día 31-60')).toBeInTheDocument();
    expect(screen.queryByText(/buddy/i)).not.toBeInTheDocument();
  });
});

describe('hire screen: what was sent to the new employee (B-07 / E-06)', () => {
  it.each([
    ['invitation_sent', /Se envió a ana@example\.org una invitación/],
    ['setup_link_sent', /ana@example\.org ya tenía acceso como candidato/],
    [
      'setup_link_failed',
      /No se pudo enviar el correo de acceso a ana@example\.org.*https:\/\/app\.example\.org\/login/,
    ],
  ] as const)('%s', (kind, text) => {
    es(<HireAccessNotice access={{ kind, email: 'ana@example.org' }} loginUrl="https://app.example.org/login" />);
    expect(screen.getByText('Acceso del nuevo colaborador')).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole(kind === 'setup_link_failed' ? 'alert' : 'status')).toBeInTheDocument();
  });
});
