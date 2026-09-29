import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP = 'true';

const PICKABLE = {
  id: '55555555-5555-4555-8555-555555555555',
  firstName: 'Leo',
  lastName: 'Lider',
  email: 'leo@acme.test',
  avatar: null,
};
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    user: {
      list: {
        useQuery: () => ({
          data: { users: [PICKABLE] },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
vi.mock('../../apps/web/lib/permissions', () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const BU = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const COMPANY = '44444444-4444-4444-8444-444444444444';
const ADA = { userId: USER, fullName: 'Ada Admin', email: 'ada@acme.test' };
const TREE = {
  businessUnits: [
    {
      id: BU,
      name: 'Operaciones',
      code: null,
      companyId: COMPANY,
      isActive: true,
      teamCount: 1,
      unitAssignees: [ADA],
      teams: [{ id: TEAM, name: 'Logística', businessUnitId: BU, isActive: true, leader: ADA, members: [] }],
    },
  ],
  companies: [{ id: COMPANY, name: 'Acme' }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let writeResponse: () => Response;

beforeEach(() => {
  fetchMock.mockReset();
  writeResponse = () => json({ id: BU });
  fetchMock.mockImplementation(async (_url, init) =>
    init?.method && init.method !== 'GET' ? writeResponse() : json(TREE),
  );
  window.confirm = vi.fn(() => true);
});

async function renderPage() {
  const { default: Page } = await import('../../apps/web/app/(admin)/settings/business-units/page');
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
  return screen.findByRole('region', { name: 'Operaciones' });
}

function writes() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method && init.method !== 'GET')
    .map(([url, init]) => ({
      url,
      method: init!.method,
      body: init!.body ? JSON.parse(String(init!.body)) : undefined,
    }));
}

describe('business units settings — C# management (flag on)', () => {
  it('renders units, assignees, teams and leader from the C# tree', async () => {
    const card = await renderPage();
    expect(within(card).getAllByText('Ada Admin').length).toBeGreaterThan(0);
    expect(within(card).getByText('Logística')).toBeInTheDocument();
    expect(screen.queryByText(/aún no está habilitada/)).not.toBeInTheDocument();
  });

  it('deactivating a unit with active teams shows the 409 as a clear inline message', async () => {
    writeResponse = () => json({ code: 'business_unit_has_active_teams', message: 'conflict' }, 409);
    const card = await renderPage();
    const [unitDeactivate] = within(card).getAllByRole('button', { name: 'Desactivar' });
    fireEvent.click(unitDeactivate!);
    expect(await within(card).findByRole('alert')).toHaveTextContent('todavía tiene equipos activos');
    expect(writes()).toEqual([
      { url: `/api/platform/tenant/org-structure/business-units/${BU}`, method: 'PATCH', body: { isActive: false } },
    ]);
  });

  it('creates a business unit from the modal', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Nueva unidad' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '  Ventas ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          url: '/api/platform/tenant/org-structure/business-units',
          method: 'POST',
          body: { name: 'Ventas', companyId: COMPANY },
        },
      ]),
    );
  });

  it('shows a failed create inside the modal', async () => {
    writeResponse = () => json({ code: 'invalid_input', message: 'Nombre duplicado' }, 400);
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Nueva unidad' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ventas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nombre duplicado');
  });

  it('clears a team leader and sets a new one through the picker', async () => {
    const card = await renderPage();
    fireEvent.click(within(card).getByRole('button', { name: 'Quitar líder' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    fireEvent.click(within(card).getByRole('button', { name: 'Cambiar líder' }));
    fireEvent.click(await screen.findByRole('button', { name: /Leo Lider/ }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()).toEqual([
      { url: `/api/platform/tenant/org-structure/teams/${TEAM}`, method: 'PATCH', body: { leaderUserId: null } },
      { url: `/api/platform/tenant/org-structure/teams/${TEAM}`, method: 'PATCH', body: { leaderUserId: PICKABLE.id } },
    ]);
  });

  it('adds a team member and removes a unit assignee', async () => {
    const card = await renderPage();
    fireEvent.click(within(card).getByRole('button', { name: 'Miembros' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar miembro' }));
    fireEvent.click(await screen.findByRole('button', { name: /Leo Lider/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0]!);
    fireEvent.click(within(card).getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()).toEqual([
      {
        url: `/api/platform/tenant/org-structure/teams/${TEAM}/members/${PICKABLE.id}`,
        method: 'PUT',
        body: { role: 'member' },
      },
      {
        url: `/api/platform/tenant/org-structure/business-units/${BU}/assignees/${USER}`,
        method: 'DELETE',
        body: undefined,
      },
    ]);
  });

  it("sets a user's primary business unit", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Unidad principal de un usuario' }));
    fireEvent.click(await screen.findByRole('button', { name: /Leo Lider/ }));
    fireEvent.change(screen.getByLabelText('Unidad principal'), { target: { value: BU } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          url: `/api/platform/tenant/org-structure/users/${PICKABLE.id}/business-unit`,
          method: 'PUT',
          body: { businessUnitId: BU },
        },
      ]),
    );
  });
});
