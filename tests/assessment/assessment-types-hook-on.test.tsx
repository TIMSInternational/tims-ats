import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_ASSESSMENT_TYPES_VIA_CSHARP = 'true';

vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const TYPE_ID = '7a000000-0000-0000-0000-00000000c0de';
const row = {
  id: TYPE_ID,
  organizationId: '11111111-1111-1111-1111-111111111111',
  name: 'Logica',
  code: 'logica',
  description: null,
  duration: null,
  isActive: true,
  createdAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
};
const messages = {
  duplicateName: 'dup',
  forbidden: 'forbidden',
  notFound: 'gone',
  nameRequired: 'name',
  failed: 'failed',
  unavailable: 'unavailable',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => fetchMock.mockReset());

describe('assessment-type C# wrapper (flag on)', () => {
  it('creates via POST /assessments/types exactly once and validates the response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(row), { status: 200 }));
    const { useCreateAssessmentType, isAssessmentTypeAuthoringEnabled } =
      await import('../../apps/web/lib/platform-api/assessment-types');
    expect(isAssessmentTypeAuthoringEnabled()).toBe(true);
    const { result } = renderHook(() => useCreateAssessmentType('unavailable'), { wrapper });
    let output: unknown;
    await act(async () => {
      output = await result.current.mutateAsync({ name: '  Logica ', description: null, duration: null });
    });
    expect(output).toEqual(row);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/assessments/types');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Logica', description: null, duration: null });
  });

  it('surfaces a 409 as a duplicate-name message (no silent failure, no retry)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'duplicate_name', message: 'Ya existe' }), { status: 409 }),
    );
    const { useCreateAssessmentType } = await import('../../apps/web/lib/platform-api/assessment-types');
    const { assessmentTypeErrorMessage } =
      await import('../../apps/web/app/(admin)/recruitment/assessments/assessment-type-error');
    const { result } = renderHook(() => useCreateAssessmentType('unavailable'), { wrapper });
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync({ name: 'Logica' }).catch((e: unknown) => e);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assessmentTypeErrorMessage(caught, messages)).toBe('dup');
  });

  it('tells a handler 404 (type gone) from an unmapped-route 404 (API flag off)', async () => {
    const { useUpdateAssessmentType } = await import('../../apps/web/lib/platform-api/assessment-types');
    const { assessmentTypeErrorMessage } =
      await import('../../apps/web/app/(admin)/recruitment/assessments/assessment-type-error');
    const { result } = renderHook(() => useUpdateAssessmentType('unavailable'), { wrapper });

    // The C# handler's own 404 carries { message } — the id is not in the caller's org.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Tipo de evaluacion no encontrado' }), { status: 404 }),
    );
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync({ id: TYPE_ID, name: 'X' }).catch((e: unknown) => e);
    });
    expect(assessmentTypeErrorMessage(caught, messages)).toBe('gone');

    // ASP.NET's 404 for a route that was never mapped (Platform:AssessmentTypeWriteEnabled=false) has no body.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await act(async () => {
      caught = await result.current.mutateAsync({ id: TYPE_ID, name: 'X' }).catch((e: unknown) => e);
    });
    expect(assessmentTypeErrorMessage(caught, messages)).toBe('unavailable');
  });

  it('rejects a response that drifts from the strict schema', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...row, config: {} }), { status: 200 }));
    const { useCreateAssessmentType } = await import('../../apps/web/lib/platform-api/assessment-types');
    const { result } = renderHook(() => useCreateAssessmentType('unavailable'), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ name: 'Logica' })).rejects.toThrow();
    });
  });

  it('deactivates via POST /assessments/types/{id}/deactivate and requires isActive=false back', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...row, isActive: false }), { status: 200 }));
    const { useDeactivateAssessmentType } = await import('../../apps/web/lib/platform-api/assessment-types');
    const { result } = renderHook(() => useDeactivateAssessmentType('unavailable'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(TYPE_ID);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/assessments/types/${TYPE_ID}/deactivate`);
    expect(init?.method).toBe('POST');
  });

  it('updates via PATCH with only the provided fields', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...row, name: 'Nuevo' }), { status: 200 }));
    const { useUpdateAssessmentType } = await import('../../apps/web/lib/platform-api/assessment-types');
    const { result } = renderHook(() => useUpdateAssessmentType('unavailable'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: TYPE_ID, name: 'Nuevo' });
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/assessments/types/${TYPE_ID}`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Nuevo' });
  });
});
