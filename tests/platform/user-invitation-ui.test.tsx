import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, renderHook, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '../../apps/web/lib/i18n/en.json';

process.env.NEXT_PUBLIC_USER_INVITATION_CREATE_VIA_CSHARP = 'true';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), legacy: vi.fn(), toast: vi.fn(), enabled: true }));
const org = '22222222-2222-4222-8222-222222222222';
vi.mock('../../apps/web/lib/platform-api/client', () => ({ platformGet: mocks.get, platformPost: mocks.post, isPlatformApiEnabled: () => mocks.enabled }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json'); return { useI18n: () => ({ t }) };
});
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { platform: {
  createUserInvitation: { useMutation: () => ({ mutateAsync: mocks.legacy }) },
  listOrganizations: { useQuery: () => ({ data: { organizations: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Target', slug: 'target' }] } }) },
  bulkInviteUsers: { useMutation: () => ({ mutate: vi.fn() }) },
} } }));
vi.mock('../../apps/web/components', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ErrorState: ({ onRetry }: { onRetry: () => void }) => <button onClick={onRetry}>Retry roles</button>,
}));
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>; }
beforeEach(() => {
  mocks.get.mockReset(); mocks.post.mockReset(); mocks.legacy.mockReset(); mocks.toast.mockReset(); mocks.enabled = true;
  mocks.get.mockResolvedValue({ roles: [{ slug: 'tenant_role', name: 'Tenant role' }] });
});

it.each(['accepted', 'unconfirmed', 'changed', 'state_unconfirmed'])('modal sends tenant role and reports %s', async (delivery) => {
  mocks.post.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', organizationId: org, delivery });
  const { InviteUserModal } = await import('../../apps/web/app/(admin)/platform/invitations/invite-user-modal');
  const refresh = vi.fn(); const view = render(<InviteUserModal onClose={vi.fn()} onSuccess={refresh} preselectedOrgId={org} preselectedOrgName="Target" />, { wrapper });
  await view.findByRole('option', { name: 'Tenant role' });
  expect(view.queryByRole('option', { name: 'Super Administrador' })).toBeNull();
  fireEvent.change(view.getByPlaceholderText('usuario@empresa.com'), { target: { value: 'invitee@example.test' } });
  fireEvent.change(view.getByRole('combobox'), { target: { value: 'tenant_role' } });
  fireEvent.click(view.getByRole('button', { name: en.invitations.sendInvitation }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/platform/invitations/organizations/{id}/roles', undefined, { id: org });
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/platform/invitations/users', { email: 'invitee@example.test', organizationId: org, roleSlug: 'tenant_role' });
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(delivery === 'accepted' ? en.invitations.userInvitationSent : en.invitations.userInviteDeliveryUnconfirmed, { type: delivery === 'accepted' ? 'success' : 'warning' });
  expect(mocks.legacy).not.toHaveBeenCalled(); view.unmount();
});

it('wizard single mode uses the C# writer and warns on uncertain delivery', async () => {
  mocks.post.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', organizationId: org, delivery: 'unconfirmed' });
  const { InviteWizard } = await import('../../apps/web/app/(admin)/platform/users/invite-wizard');
  const refresh = vi.fn(); const view = render(<InviteWizard onClose={vi.fn()} onSuccess={refresh} />, { wrapper });
  fireEvent.change(view.getByPlaceholderText(en.invitations.searchOrganization), { target: { value: 'Target' } });
  fireEvent.click(view.getByRole('button', { name: /Target/ }));
  await view.findByRole('option', { name: 'Tenant role' });
  fireEvent.change(view.getByPlaceholderText('usuario@empresa.com'), { target: { value: 'invitee@example.test' } });
  fireEvent.change(view.getByRole('combobox'), { target: { value: 'tenant_role' } });
  fireEvent.submit(view.getByPlaceholderText('usuario@empresa.com').closest('form')!);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(en.invitations.userInviteDeliveryUnconfirmed, { type: 'warning' });
  expect(mocks.post).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled(); view.unmount();
});

it('role lookup failure shows retry without offering fixed fallback roles', async () => {
  mocks.get.mockRejectedValue(new Error('failed'));
  const { InviteUserModal } = await import('../../apps/web/app/(admin)/platform/invitations/invite-user-modal');
  const view = render(<InviteUserModal onClose={vi.fn()} onSuccess={vi.fn()} preselectedOrgId={org} />, { wrapper });
  await view.findByRole('button', { name: 'Retry roles' });
  expect(view.queryByRole('option', { name: 'Super Administrador' })).toBeNull();
  expect(mocks.get).toHaveBeenCalledOnce(); expect(mocks.post).not.toHaveBeenCalled(); view.unmount();
});

it('changing organization does not retain the previous role choices', async () => {
  const { useUserInvitationRoles } = await import('../../apps/web/lib/platform-api/user-invitation-roles');
  const { result, rerender } = renderHook(({ id }) => useUserInvitationRoles(id, []), { wrapper, initialProps: { id: org } });
  await waitFor(() => expect(result.current.roles).toHaveLength(1));
  mocks.get.mockReturnValue(new Promise(() => {}));
  act(() => rerender({ id: '33333333-3333-4333-8333-333333333333' }));
  expect(result.current.roles).toEqual([]);
});

it.each(['modal', 'wizard'])('%s clears its selected role when an organization is reselected', async (surface) => {
  const { InviteUserModal } = await import('../../apps/web/app/(admin)/platform/invitations/invite-user-modal');
  const { InviteWizard } = await import('../../apps/web/app/(admin)/platform/users/invite-wizard');
  const view = render(surface === 'modal'
    ? <InviteUserModal onClose={vi.fn()} onSuccess={vi.fn()} preselectedOrgId={org} preselectedOrgName="Target" />
    : <InviteWizard onClose={vi.fn()} onSuccess={vi.fn()} />, { wrapper });
  const search = view.getByPlaceholderText(surface === 'modal' ? en.organizations.searchOrg : en.invitations.searchOrganization);
  if (surface === 'wizard') {
    fireEvent.change(search, { target: { value: 'Target' } });
    fireEvent.click(view.getByRole('button', { name: /Target/ }));
  }
  await view.findByRole('option', { name: 'Tenant role' });
  fireEvent.change(view.getByRole('combobox'), { target: { value: 'tenant_role' } });
  fireEvent.change(search, { target: { value: 'Target again' } });
  fireEvent.click(view.getByRole('button', { name: /Target/ }));
  await view.findByRole('option', { name: 'Tenant role' });
  expect((view.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(mocks.post).not.toHaveBeenCalled(); view.unmount();
});
