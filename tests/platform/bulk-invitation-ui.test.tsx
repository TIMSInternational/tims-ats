import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, renderHook, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '../../apps/web/lib/i18n/en.json';

process.env.NEXT_PUBLIC_BULK_INVITATION_VIA_CSHARP = 'true';
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

it('submits CSV and displays partial outcomes with recovery guidance',async()=>{
  mocks.post.mockResolvedValue({results:[
    {index:0,email:'a@example.test',status:'sent',reason:null},
    {index:1,email:'b@example.test',status:'error',reason:'delivery_unconfirmed'},
    {index:2,email:'A@example.test',status:'duplicate',reason:'duplicate_row'},
  ],summary:{total:3,sent:1,duplicates:1,errors:1}});
  const {InviteWizard}=await import('../../apps/web/app/(admin)/platform/users/invite-wizard');
  const close=vi.fn();const view=render(<InviteWizard onClose={vi.fn()} onSuccess={close}/>,{wrapper});
  fireEvent.click(view.getByRole('button',{name:en.invitations.bulkMode}));
  fireEvent.change(view.getByPlaceholderText(en.invitations.searchOrganization),{target:{value:'Target'}});
  fireEvent.click(view.getByRole('button',{name:/Target/}));
  const file=new File(['email\na@example.test\nb@example.test\nA@example.test'],'invite.csv',{type:'text/csv'});
  fireEvent.change(view.getByLabelText(en.invitations.selectFile),{target:{files:[file]}});
  fireEvent.click(await view.findByRole('button',{name:'Continuar'}));
  fireEvent.click(view.getByRole('button',{name:'Invitar 3 Usuarios'}));
  await view.findByText(en.invitations.bulkResultsTitle);
  expect(view.getByText(en.invitations.bulkDeliveryUnconfirmed)).toBeTruthy();
  expect(view.getByText(en.invitations.bulkDuplicateRow)).toBeTruthy();
  expect(view.getByText(en.invitations.bulkRecoveryHelp)).toBeTruthy();
  expect(view.getByRole('link',{name:en.invitations.bulkReviewInvitations}).getAttribute('href')).toBe('/platform/invitations');
  expect(mocks.post).toHaveBeenCalledOnce();expect(mocks.legacy).not.toHaveBeenCalled();
  expect(mocks.post.mock.calls[0][0]).toBe('/platform/invitations/bulk');
  fireEvent.click(view.getByRole('button',{name:en.common.close}));expect(close).toHaveBeenCalledOnce();view.unmount();
});
