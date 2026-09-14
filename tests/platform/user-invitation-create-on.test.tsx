import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_USER_INVITATION_CREATE_VIA_CSHARP = 'true';
const mocks = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn(), enabled: true, toast: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({ platformPost: mocks.post, isPlatformApiEnabled: () => mocks.enabled }));
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { platform: { createUserInvitation: { useMutation: () => ({ mutateAsync: mocks.legacy }) } } } }));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json');
  return { useI18n: () => ({ t }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
const input = { email: 'admin@example.test', organizationId: '22222222-2222-4222-8222-222222222222', roleSlug: 'recruiter' };
const response = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', delivery: 'accepted' };
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>; }
beforeEach(() => { mocks.enabled = true; mocks.post.mockReset(); mocks.legacy.mockReset(); mocks.toast.mockReset(); });

describe('C# user invitation creation', () => {
  it.each(['accepted', 'unconfirmed', 'changed', 'state_unconfirmed'])('passes delivery outcome %s to the caller without a second creation', async (delivery) => {
    mocks.post.mockResolvedValue({ ...response, delivery });
    const success = vi.fn();
    const { useUserInvitationCreate } = await import('../../apps/web/lib/platform-api/user-invitation-create');
    const { result } = renderHook(() => useUserInvitationCreate({ onSuccess: success }), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/platform/invitations/users', input);
    expect(success.mock.calls[0][0]).toBe(delivery); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('does not retry or fall back after an uncertain create', async () => {
    mocks.post.mockRejectedValue(new Error('transport failure'));
    const { useUserInvitationCreate } = await import('../../apps/web/lib/platform-api/user-invitation-create');
    const { result } = renderHook(() => useUserInvitationCreate(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow(); });
    expect(mocks.post).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it.each([{ ...response, token: 'secret' }, { ...response, delivery: 'sent' }, { ...response, organizationId: 'bad' }, { ...response, organizationId: '33333333-3333-4333-8333-333333333333' }])('rejects invalid response without success', async (body) => {
    mocks.post.mockResolvedValue(body); const success = vi.fn();
    const { useUserInvitationCreate } = await import('../../apps/web/lib/platform-api/user-invitation-create');
    const { result } = renderHook(() => useUserInvitationCreate({ onSuccess: success }), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow(); });
    expect(success).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('fails closed with missing API configuration', async () => {
    mocks.enabled = false;
    const { useUserInvitationCreate } = await import('../../apps/web/lib/platform-api/user-invitation-create');
    const { result } = renderHook(() => useUserInvitationCreate(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('unavailable'); });
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
