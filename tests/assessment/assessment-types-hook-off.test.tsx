import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// C# base URL configured, but the F13 opt-in flag is NOT: the surface must stay dark and never call fetch.
process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
delete process.env.NEXT_PUBLIC_ASSESSMENT_TYPES_VIA_CSHARP;

vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('assessment-type C# wrapper (flag off)', () => {
  it('reports disabled and fails loudly with the unavailable message without any request', async () => {
    const { useCreateAssessmentType, isAssessmentTypeAuthoringEnabled } =
      await import('../../apps/web/lib/platform-api/assessment-types');
    const { assessmentTypeErrorMessage } =
      await import('../../apps/web/app/(admin)/recruitment/assessments/assessment-type-error');
    expect(isAssessmentTypeAuthoringEnabled()).toBe(false);
    const { result } = renderHook(() => useCreateAssessmentType('unavailable'), { wrapper });
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync({ name: 'Logica' }).catch((e: unknown) => e);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      assessmentTypeErrorMessage(caught, {
        duplicateName: 'dup',
        forbidden: 'forbidden',
        notFound: 'gone',
        nameRequired: 'name',
        failed: 'failed',
        unavailable: 'unavailable',
      }),
    ).toBe('unavailable');
  });
});
