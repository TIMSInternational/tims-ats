import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_INVITATION_RESEND_VIA_CSHARP = 'true';
const mocks = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn(), enabled: true }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({
  platformPost: mocks.post,
  isPlatformApiEnabled: () => mocks.enabled,
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { platform: { resendInvitation: { useMutation: () => ({ mutateAsync: mocks.legacy }) } } },
}));
const id = '11111111-1111-4111-8111-111111111111';
const accepted = { id, status: 'sent', sentAt: '2026-09-14T12:00:00.000Z', expiresAt: '2026-09-21T12:00:00.000Z' };
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mocks.enabled = true;
  mocks.post.mockReset();
  mocks.legacy.mockReset();
});

describe('C# invitation resend', () => {
  it('calls only C# and runs the success callback after validating the response', async () => {
    mocks.post.mockResolvedValue(accepted);
    const success = vi.fn();
    const { useInvitationResend } = await import('../../apps/web/lib/platform-api/invitation-resend');
    const { result } = renderHook(() => useInvitationResend({ onSuccess: success }), { wrapper });
    await act(() => result.current.mutateAsync({ id }));
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/platform/invitations/{id}/resend', undefined, { id });
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledOnce();
  });

  it('does not retry or fall back after transport/provider failure', async () => {
    mocks.post.mockRejectedValue(new Error('Email delivery unconfirmed'));
    const { useInvitationResend } = await import('../../apps/web/lib/platform-api/invitation-resend');
    const { result } = renderHook(() => useInvitationResend(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id })).rejects.toThrow('unconfirmed');
    });
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it.each([
    { ...accepted, status: 'pending' },
    { ...accepted, id: '22222222-2222-4222-8222-222222222222' },
    { ...accepted, expiresAt: accepted.sentAt },
    { ...accepted, token: 'must-not-be-returned' },
  ])('rejects an invalid response without a success callback or fallback', async (response) => {
    mocks.post.mockResolvedValue(response);
    const success = vi.fn();
    const { useInvitationResend } = await import('../../apps/web/lib/platform-api/invitation-resend');
    const { result } = renderHook(() => useInvitationResend({ onSuccess: success }), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id })).rejects.toThrow();
    });
    expect(success).not.toHaveBeenCalled();
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it('fails closed when the switch is on but the platform URL is missing', async () => {
    mocks.enabled = false;
    const { useInvitationResend } = await import('../../apps/web/lib/platform-api/invitation-resend');
    const { result } = renderHook(() => useInvitationResend(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id })).rejects.toThrow('unavailable');
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs before dispatch', async () => {
    const { useInvitationResend } = await import('../../apps/web/lib/platform-api/invitation-resend');
    const { result } = renderHook(() => useInvitationResend(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'bad' })).rejects.toThrow();
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
