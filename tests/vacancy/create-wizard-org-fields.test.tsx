import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Both C# flags off: the wizard reads units/teams from the existing tRPC organization reads.
delete process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP;
delete process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP;

const BU = '11111111-1111-4111-8111-111111111111';
const TEAM_A = '22222222-2222-4222-8222-222222222222';
const TEAM_B = '66666666-6666-4666-8666-666666666666';
const MANAGER = {
  id: '55555555-5555-4555-8555-555555555555',
  firstName: 'Hana',
  lastName: 'Manager',
  email: 'h@acme.test',
  avatar: null,
};

type QueryResult = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
const ok = (data: unknown): QueryResult => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const state = vi.hoisted(() => ({ companies: null as unknown, teams: null as unknown }));
const listTeams = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    organization: {
      listCompanies: { useQuery: () => state.companies },
      listTeams: {
        useQuery: (input: { businessUnitId: string }, opts: { enabled: boolean }) => listTeams(input, opts),
      },
    },
    user: { list: { useQuery: () => ok({ users: [MANAGER] }) } },
    vacancy: {
      generateDescription: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      checkInclusiveLanguage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

beforeEach(() => {
  state.companies = ok([{ id: 'c1', name: 'Acme', businessUnits: [{ id: BU, name: 'Operaciones' }] }]);
  listTeams.mockReset();
  listTeams.mockImplementation((_input: unknown, opts: { enabled: boolean }) =>
    ok(
      opts.enabled
        ? [
            { id: TEAM_A, name: 'Logística', leader: { id: 'x' } },
            { id: TEAM_B, name: 'Bodega', leader: null },
          ]
        : undefined,
    ),
  );
});

async function renderWizard(props: { errorMessage?: string | null } = {}) {
  const { CreateModal } = await import('../../apps/web/app/(admin)/recruitment/vacancies/create-modal');
  const onConfirm = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateModal onConfirm={onConfirm} onClose={() => {}} isPending={false} {...props} />
    </QueryClientProvider>,
  );
  return onConfirm;
}

function goToStep3() {
  fireEvent.change(screen.getByPlaceholderText('Ej: Senior Software Engineer'), { target: { value: 'Analista' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
}

describe('vacancy create wizard — org placement, approval/publish exclusivity, errors', () => {
  it('offers business units and only the chosen unit teams, and sends them with the hiring manager', async () => {
    const onConfirm = await renderWizard();
    const team = screen.getByLabelText('Equipo');
    expect(team).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Unidad de negocio'), { target: { value: BU } });
    expect(listTeams).toHaveBeenLastCalledWith({ businessUnitId: BU }, expect.objectContaining({ enabled: true }));
    fireEvent.change(screen.getByLabelText('Equipo'), { target: { value: TEAM_B } });
    expect(screen.getByText(/no tiene líder/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar hiring manager' }));
    fireEvent.click(screen.getByRole('button', { name: /Hana Manager/ }));
    goToStep3();
    fireEvent.click(screen.getByRole('button', { name: 'Crear vacante' }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ businessUnitId: BU, teamId: TEAM_B, assignedTo: MANAGER.id }),
    );
  });

  it('hides the unit/team selects with a hint when the user cannot read the org structure (403)', async () => {
    state.companies = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { data: { code: 'FORBIDDEN' } },
      refetch: vi.fn(),
    };
    await renderWizard();
    expect(screen.queryByLabelText('Unidad de negocio')).not.toBeInTheDocument();
    expect(screen.getByText(/No tienes acceso a la estructura organizacional/)).toBeInTheDocument();
  });

  it('makes auto-publish and approval mutually exclusive with a visible explanation', async () => {
    const onConfirm = await renderWizard();
    goToStep3();
    const autoPublish = screen.getByRole('checkbox', { name: /Publicar automáticamente/ });
    const approval = screen.getByRole('checkbox', { name: /Requiere aprobación/ });
    expect(approval).toBeChecked();
    expect(autoPublish).toBeDisabled();
    expect(screen.getByText(/solo está disponible si la vacante no requiere aprobación/)).toBeInTheDocument();
    fireEvent.click(approval);
    expect(autoPublish).toBeEnabled();
    fireEvent.click(autoPublish);
    expect(autoPublish).toBeChecked();
    fireEvent.click(approval);
    expect(autoPublish).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Crear vacante' }));
    expect(onConfirm.mock.calls[0]![0].settings).toMatchObject({ requireApproval: true, autoPublish: false });
  });

  it('shows the server error inside the wizard', async () => {
    await renderWizard({ errorMessage: 'autoPublish requiere requireApproval en false' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo crear la vacante: autoPublish requiere requireApproval en false',
    );
  });
});
