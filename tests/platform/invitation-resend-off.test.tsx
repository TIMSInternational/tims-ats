import React from 'react';
import { expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_INVITATION_RESEND_VIA_CSHARP = 'false';
const mocks = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn().mockResolvedValue({ status: 'sent' }) }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({
  platformPost: mocks.post,
  isPlatformApiEnabled: () => true,
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { platform: { resendInvitation: { useMutation: () => ({ mutateAsync: mocks.legacy }) } } },
}));

it('keeps the existing tRPC path when the switch is off', async () => {
  const { useInvitationResend } = await import('../../apps/web/lib/platform-api/invitation-resend');
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useInvitationResend(), { wrapper });
  const input = { id: '11111111-1111-4111-8111-111111111111' };
  await act(() => result.current.mutateAsync(input));
  expect(mocks.legacy).toHaveBeenCalledExactlyOnceWith(input);
  expect(mocks.post).not.toHaveBeenCalled();
});
