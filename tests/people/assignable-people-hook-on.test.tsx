import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP = 'true';

const legacyUseQuery = vi.hoisted(() =>
  vi.fn((_input: unknown, _opts: { enabled?: boolean }) => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
);
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { user: { list: { useQuery: legacyUseQuery } } } }));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const ADA = {
  id: '11111111-1111-4111-8111-111111111111',
  firstName: 'Ada',
  lastName: 'Admin',
  email: 'ada@acme.test',
  avatarUrl: 'https://cdn.test/ada.png',
  roleSlugs: ['super_admin'],
};
const HUGO = {
  id: '22222222-2222-4222-8222-222222222222',
  firstName: 'Hugo',
  lastName: 'Hr',
  email: 'hugo@acme.test',
  roleSlugs: ['hr_admin'],
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  legacyUseQuery.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ people: [ADA, HUGO] }), { status: 200 }));
});

describe('assignable people — C# directory routing (flag on)', () => {
  it('reads the C# directory through the same-origin relay and never enables tRPC user.list', async () => {
    const { useAssignablePeople } = await import('../../apps/web/lib/platform-api/assignable-people');
    const { result } = renderHook(() => useAssignablePeople({ purpose: 'offer_approver', search: '  ada ' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.people).toHaveLength(2));
    expect(result.current.people[0]).toEqual({
      id: ADA.id,
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@acme.test',
      avatar: 'https://cdn.test/ada.png',
    });
    expect(result.current.people[1]!.avatar).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/platform/tenant/people/assignable?purpose=offer_approver&search=ada&limit=50');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(legacyUseQuery.mock.calls.every(([, opts]) => opts.enabled === false)).toBe(true);
  });

  it('maps a 403 to the forbidden state without retrying or falling back', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    const { useAssignablePeople } = await import('../../apps/web/lib/platform-api/assignable-people');
    const { result } = renderHook(() => useAssignablePeople({ purpose: 'vacancy_approver' }), { wrapper });
    await waitFor(() => expect(result.current.failure).toBe('forbidden'));
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a malformed or over-exposing payload as unavailable (strict schema)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ people: [{ ...ADA, phone: '+57 300' }] }), { status: 200 }),
    );
    const { useAssignablePeople } = await import('../../apps/web/lib/platform-api/assignable-people');
    const { result } = renderHook(() => useAssignablePeople({ purpose: 'interview_evaluator' }), { wrapper });
    await waitFor(() => expect(result.current.failure).toBe('unavailable'));
    expect(result.current.people).toEqual([]);
  });

  it('UserPicker with a purpose shows a translated error instead of an endless loading label', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    const { UserPicker } = await import('../../apps/web/components/user-picker');
    render(
      <UserPicker
        purpose="vacancy_approver"
        onSelect={() => {}}
        searchPlaceholder="buscar"
        loadingLabel="Cargando..."
        emptyLabel="vacío"
      />,
      { wrapper },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar las personas disponibles');
    expect(screen.queryByText('Cargando...')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('UserPicker lists directory people for its purpose', async () => {
    const { UserPicker } = await import('../../apps/web/components/user-picker');
    render(
      <UserPicker
        purpose="interview_evaluator"
        onSelect={() => {}}
        searchPlaceholder="s"
        loadingLabel="l"
        emptyLabel="e"
      />,
      { wrapper },
    );
    expect(await screen.findByText('Ada Admin')).toBeTruthy();
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/platform/tenant/people/assignable?purpose=interview_evaluator&limit=25',
    );
  });
});
