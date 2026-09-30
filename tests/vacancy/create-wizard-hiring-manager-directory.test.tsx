import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// People directory flag ON: the wizard's hiring manager feeds vacancy.create's assignedTo, which accepts ANY
// active member — so it must read purpose=vacancy_assignee, not vacancy_approver (approve-holders only, and
// gated on vacancy:update, which a vacancy creator such as a leader may not hold).
process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP = 'true';
delete process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP;

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    organization: {
      listCompanies: { useQuery: () => ok([]) },
      listTeams: { useQuery: () => ok(undefined) },
    },
    user: { list: { useQuery: () => ok({ users: [] }) } },
    vacancy: {
      generateDescription: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      checkInclusiveLanguage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const EMPLOYEE = {
  id: '55555555-5555-4555-8555-555555555555',
  firstName: 'Eli',
  lastName: 'Empleado',
  email: 'eli@acme.test',
  avatarUrl: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ people: [EMPLOYEE] }), { status: 200 }));
});

describe('vacancy create wizard — hiring manager picker (C# people directory)', () => {
  it('reads purpose=vacancy_assignee and lets any listed member be picked', async () => {
    const { CreateModal } = await import('../../apps/web/app/(admin)/recruitment/vacancies/create-modal');
    const onConfirm = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateModal onConfirm={onConfirm} onClose={() => {}} isPending={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar hiring manager' }));
    fireEvent.click(await screen.findByRole('button', { name: /Eli Empleado/ }));

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(
      urls.some((url) => url.includes('/tenant/people/assignable') && url.includes('purpose=vacancy_assignee')),
    ).toBe(true);
    expect(urls.some((url) => url.includes('purpose=vacancy_approver'))).toBe(false);

    fireEvent.change(screen.getByPlaceholderText('Ej: Senior Software Engineer'), { target: { value: 'Analista' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear vacante' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: EMPLOYEE.id })));
  });
});
