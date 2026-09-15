import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
delete process.env.NEXT_PUBLIC_TENANT_AUDIT_VIA_CSHARP;
const legacyExport = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: '', count: 0, truncated: false, format: 'csv' }),
);
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { audit: { exportLogs: { useMutation: () => ({ mutateAsync: legacyExport }) } } },
}));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: vi.fn() }));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('tenant audit default-off routing', () => {
  it('keeps the current tRPC behavior until explicitly enabled', async () => {
    const { useTenantAuditExport } = await import('../../apps/web/lib/platform-api/tenant-audit');
    const { result } = renderHook(() => useTenantAuditExport(), { wrapper });
    const input = { format: 'csv' as const, dateFrom: new Date('2026-09-01'), entity: 'candidate' };
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(legacyExport).toHaveBeenCalledExactlyOnceWith(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
