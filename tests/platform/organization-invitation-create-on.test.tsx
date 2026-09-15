import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_ORG_INVITATION_CREATE_VIA_CSHARP = 'true';
const mocks = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn(), enabled: true, toast: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({ platformPost: mocks.post, isPlatformApiEnabled: () => mocks.enabled }));
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { platform: { createOrgInvitation: { useMutation: () => ({ mutateAsync: mocks.legacy }) } } } }));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json');
  return { useI18n: () => ({ t }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
const input = { email: 'admin@example.test', organizationName: 'Example', organizationSlug: 'example', organizationPlan: 'trial' as const };
const response = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', delivery: 'accepted' };
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>; }
beforeEach(() => { mocks.enabled = true; mocks.post.mockReset(); mocks.legacy.mockReset(); mocks.toast.mockReset(); });

describe('C# organization invitation creation', () => {
  it.each(['accepted', 'unconfirmed', 'changed', 'state_unconfirmed'])('passes delivery outcome %s to the caller without a second creation', async (delivery) => {
    mocks.post.mockResolvedValue({ ...response, delivery });
    const success = vi.fn();
    const { useOrganizationInvitationCreate } = await import('../../apps/web/lib/platform-api/organization-invitation-create');
    const { result } = renderHook(() => useOrganizationInvitationCreate({ onSuccess: success }), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/platform/invitations/organizations', input);
    expect(success.mock.calls[0][0]).toBe(delivery); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('does not retry or fall back after an uncertain create', async () => {
    mocks.post.mockRejectedValue(new Error('transport failure'));
    const { useOrganizationInvitationCreate } = await import('../../apps/web/lib/platform-api/organization-invitation-create');
    const { result } = renderHook(() => useOrganizationInvitationCreate(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow(); });
    expect(mocks.post).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it.each([{ ...response, token: 'secret' }, { ...response, delivery: 'sent' }, { ...response, organizationId: 'bad' }])('rejects invalid response without success', async (body) => {
    mocks.post.mockResolvedValue(body); const success = vi.fn();
    const { useOrganizationInvitationCreate } = await import('../../apps/web/lib/platform-api/organization-invitation-create');
    const { result } = renderHook(() => useOrganizationInvitationCreate({ onSuccess: success }), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow(); });
    expect(success).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('fails closed with missing API configuration', async () => {
    mocks.enabled = false;
    const { useOrganizationInvitationCreate } = await import('../../apps/web/lib/platform-api/organization-invitation-create');
    const { result } = renderHook(() => useOrganizationInvitationCreate(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('unavailable'); });
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
});

it.each(['accepted', 'unconfirmed', 'changed', 'state_unconfirmed'])('modal reports %s honestly and refreshes after creation', async (delivery) => {
  mocks.post.mockResolvedValue({ ...response, delivery });
  const { InviteOrgModal } = await import('../../apps/web/app/(admin)/platform/invitations/invite-org-modal');
  const { default: en } = await import('../../apps/web/lib/i18n/en.json');
  const refresh = vi.fn();
  const view = render(<InviteOrgModal onClose={vi.fn()} onSuccess={refresh} />, { wrapper });
  const fields = view.getAllByRole('textbox');
  fireEvent.change(fields[0], { target: { value: input.email } });
  fireEvent.change(fields[1], { target: { value: input.organizationName } });
  fireEvent.change(fields[2], { target: { value: input.organizationSlug } });
  fireEvent.click(view.getByRole('button', { name: en.invitations.createAndSend }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
    delivery === 'accepted' ? en.invitations.orgInviteSent : en.invitations.orgInviteDeliveryUnconfirmed,
    { type: delivery === 'accepted' ? 'success' : 'warning' },
  );
  expect(mocks.post).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled();
  view.unmount();
});
