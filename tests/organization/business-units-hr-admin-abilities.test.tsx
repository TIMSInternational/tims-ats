import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The C# org-structure gates follow today's tRPC capabilities (TenantOrgStructureEndpoints): a seed-shaped
// hr_admin (organization:read + user:*, seed-access-matrix.ts) manages PEOPLE on the structure but not the
// structure itself. The screen must offer exactly what the server will accept, or hr_admin clicks into 403s.
process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP = 'true';

const HR_ADMIN_GRANTS = new Set(['organization:read', 'user:read', 'user:create', 'user:update', 'user:delete']);
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({ can: (module: string, action = 'read') => HR_ADMIN_GRANTS.has(`${module}:${action}`) }),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    user: {
      list: {
        useQuery: () => ({ data: { users: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
      },
    },
  },
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const BU = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const ADA = { userId: '33333333-3333-4333-8333-333333333333', fullName: 'Ada Admin', email: 'ada@acme.test' };
const TREE = {
  businessUnits: [
    {
      id: BU,
      name: 'Operaciones',
      code: null,
      companyId: '44444444-4444-4444-8444-444444444444',
      isActive: true,
      teamCount: 1,
      unitAssignees: [ADA],
      teams: [{ id: TEAM, name: 'Logística', businessUnitId: BU, isActive: true, leader: ADA, members: [] }],
    },
  ],
  companies: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Acme' }],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(TREE), { status: 200 }));
});

describe('business units settings — hr_admin (organization:read + user:*)', () => {
  it('offers people assignment (assignees, members, leader, home unit) but no structure edits', async () => {
    const { default: Page } = await import('../../apps/web/app/(admin)/settings/business-units/page');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    const card = await screen.findByRole('region', { name: 'Operaciones' });

    // user:create / user:delete / user:update
    expect(within(card).getByRole('button', { name: 'Agregar responsable' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Miembros' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cambiar líder' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Quitar líder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unidad principal de un usuario' })).toBeInTheDocument();

    // organization:create / organization:update — super_admin only
    expect(screen.queryByRole('button', { name: 'Nueva unidad' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Nuevo equipo' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Renombrar' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });
});
