import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP = 'true';

const listCompanies = vi.hoisted(() =>
  vi.fn((_i: unknown, _o: { enabled?: boolean }) => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  })),
);
const listTeams = vi.hoisted(() =>
  vi.fn((_i: unknown, _o: { enabled?: boolean }) => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  })),
);
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { organization: { listCompanies: { useQuery: listCompanies }, listTeams: { useQuery: listTeams } } },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const BU = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const COMPANY = '44444444-4444-4444-8444-444444444444';

const TREE = {
  businessUnits: [
    {
      id: BU,
      name: 'Operaciones',
      code: 'OPS',
      companyId: COMPANY,
      isActive: true,
      teamCount: 1,
      unitAssignees: [{ userId: USER, fullName: 'Ada Admin', email: 'ada@acme.test' }],
      teams: [
        {
          id: TEAM,
          name: 'Logística',
          businessUnitId: BU,
          isActive: true,
          leader: { userId: USER, fullName: 'Ada Admin', email: 'ada@acme.test' },
          members: [{ userId: USER, fullName: 'Ada Admin', email: 'ada@acme.test', role: 'lead' }],
        },
      ],
    },
  ],
  companies: [{ id: COMPANY, name: 'Acme' }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockReset();
  listCompanies.mockClear();
  listTeams.mockClear();
});

describe('org-structure wrapper — flag on', () => {
  it('reads and zod-validates the tree through the same-origin relay', async () => {
    fetchMock.mockResolvedValue(json(TREE));
    const { useOrgStructure } = await import('../../apps/web/lib/platform-api/org-structure');
    const { result } = renderHook(() => useOrgStructure(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.businessUnits[0]?.teams[0]?.leader?.fullName).toBe('Ada Admin');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/platform/tenant/org-structure');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('rejects a response that drifts from the contract (unknown field) instead of rendering it', async () => {
    fetchMock.mockResolvedValue(json({ ...TREE, salaries: [1] }));
    const { useOrgStructure } = await import('../../apps/web/lib/platform-api/org-structure');
    const { result } = renderHook(() => useOrgStructure(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it.each([
    [
      'createBusinessUnit',
      { name: 'Ventas', companyId: COMPANY },
      'POST',
      '/tenant/org-structure/business-units',
      { name: 'Ventas', companyId: COMPANY },
    ],
    [
      'updateBusinessUnit',
      { id: BU, isActive: false },
      'PATCH',
      `/tenant/org-structure/business-units/${BU}`,
      { isActive: false },
    ],
    [
      'createTeam',
      { businessUnitId: BU, name: 'Norte' },
      'POST',
      '/tenant/org-structure/teams',
      { businessUnitId: BU, name: 'Norte' },
    ],
    [
      'updateTeam',
      { id: TEAM, leaderUserId: null },
      'PATCH',
      `/tenant/org-structure/teams/${TEAM}`,
      { leaderUserId: null },
    ],
    [
      'addTeamMember',
      { teamId: TEAM, userId: USER, role: 'member' },
      'PUT',
      `/tenant/org-structure/teams/${TEAM}/members/${USER}`,
      { role: 'member' },
    ],
    [
      'removeTeamMember',
      { teamId: TEAM, userId: USER },
      'DELETE',
      `/tenant/org-structure/teams/${TEAM}/members/${USER}`,
      undefined,
    ],
    [
      'addUnitAssignee',
      { businessUnitId: BU, userId: USER },
      'PUT',
      `/tenant/org-structure/business-units/${BU}/assignees/${USER}`,
      undefined,
    ],
    [
      'removeUnitAssignee',
      { businessUnitId: BU, userId: USER },
      'DELETE',
      `/tenant/org-structure/business-units/${BU}/assignees/${USER}`,
      undefined,
    ],
    [
      'setUserBusinessUnit',
      { userId: USER, businessUnitId: null },
      'PUT',
      `/tenant/org-structure/users/${USER}/business-unit`,
      { businessUnitId: null },
    ],
  ] as const)('%s sends %s %s', async (operation, input, method, path, body) => {
    fetchMock.mockResolvedValue(
      method === 'POST'
        ? json({ id: BU, name: 'x' }, 201)
        : method === 'DELETE'
          ? new Response(null, { status: 204 })
          : json({}),
    );
    const { useOrgStructureMutation } = await import('../../apps/web/lib/platform-api/org-structure');
    const { result } = renderHook(() => useOrgStructureMutation(operation), { wrapper });
    await act(async () => {
      await (result.current.mutateAsync as (value: unknown) => Promise<unknown>)(input);
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/platform${path}`);
    expect(init?.method).toBe(method);
    expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(body);
  });

  it('classifies the 409 business_unit_has_active_teams conflict by its code', async () => {
    fetchMock.mockResolvedValue(json({ code: 'business_unit_has_active_teams', message: 'x' }, 409));
    const { useOrgStructureMutation, classifyOrgStructureError } =
      await import('../../apps/web/lib/platform-api/org-structure');
    const onError = vi.fn();
    const { result } = renderHook(() => useOrgStructureMutation('updateBusinessUnit', { onError }), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: BU, isActive: false }).catch(() => undefined);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(classifyOrgStructureError(onError.mock.calls[0]![0])).toBe('has_active_teams');
  });

  it('vacancy wizard options come from C# /options, filtered to the chosen unit, with tRPC disabled', async () => {
    fetchMock.mockResolvedValue(
      json({
        businessUnits: [{ id: BU, name: 'Operaciones', teams: [{ id: TEAM, name: 'Logística', hasLeader: false }] }],
      }),
    );
    const { useVacancyOrgOptions } = await import('../../apps/web/lib/platform-api/org-structure-options');
    const { result, rerender } = renderHook(({ unit }) => useVacancyOrgOptions(unit), {
      wrapper,
      initialProps: { unit: null as string | null },
    });
    await waitFor(() => expect(result.current.units).toEqual([{ id: BU, name: 'Operaciones' }]));
    expect(result.current.teams).toEqual([]);
    rerender({ unit: BU });
    expect(result.current.teams).toEqual([{ id: TEAM, name: 'Logística', hasLeader: false }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/platform/tenant/org-structure/options');
    expect(listCompanies.mock.calls.every(([, opts]) => opts.enabled === false)).toBe(true);
    expect(listTeams.mock.calls.every(([, opts]) => opts.enabled === false)).toBe(true);
  });

  it('a 403 on /options is reported as forbidden (the wizard hides the fields)', async () => {
    fetchMock.mockResolvedValue(json({ message: 'no' }, 403));
    const { useVacancyOrgOptions } = await import('../../apps/web/lib/platform-api/org-structure-options');
    const { result } = renderHook(() => useVacancyOrgOptions(null), { wrapper });
    await waitFor(() => expect(result.current.failure).toBe('forbidden'));
  });
});
