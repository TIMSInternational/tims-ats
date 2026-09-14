import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_AUDIT_VIA_CSHARP = 'true';

const legacyExport = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { audit: { exportLogs: { useMutation: () => ({ mutateAsync: legacyExport }) } } },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);
const payload = { data: '[]', format: 'json', count: '0', truncated: false };

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  legacyExport.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
});

describe('tenant audit C# export routing', () => {
  it('posts filters through the session-authenticated same-origin relay exactly once', async () => {
    const { useTenantAuditExport } = await import('../../apps/web/lib/platform-api/tenant-audit');
    const { result } = renderHook(() => useTenantAuditExport(), { wrapper });
    await act(async () => {
      const output = await result.current.mutateAsync({
        format: 'json',
        dateFrom: new Date('2026-09-01T00:00:00Z'),
        action: 'access',
      });
      expect(output.count).toBe(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(legacyExport).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/platform/tenant-audit/export');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(init?.body))).toEqual({
      format: 'json',
      dateFrom: '2026-09-01T00:00:00.000Z',
      action: 'access',
    });
  });

  it('does not retry or fall back after a C# permission denial', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    const { useTenantAuditExport } = await import('../../apps/web/lib/platform-api/tenant-audit');
    const { result } = renderHook(() => useTenantAuditExport(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ format: 'json' })).rejects.toMatchObject({ status: 403 });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(legacyExport).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload, count: 10001 },
    { ...payload, count: true },
    { ...payload, truncated: 'false' },
    { ...payload, format: 'csv' },
  ])('rejects malformed or mismatched exports without falling back: %j', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const { useTenantAuditExport } = await import('../../apps/web/lib/platform-api/tenant-audit');
    const { result } = renderHook(() => useTenantAuditExport(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ format: 'json' })).rejects.toThrow();
    });
    expect(legacyExport).not.toHaveBeenCalled();
  });
});
