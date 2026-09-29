import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  enabled: true,
  canCreate: true,
  permsLoading: false,
  create: vi.fn(),
  createCallbacks: {} as { onSuccess?: (d: string) => void; onError?: (e: Error) => void },
  revoke: vi.fn(),
  resend: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'es' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({
    can: (module: string, action?: string) => module === 'user' && (action === 'read' || mocks.canCreate),
    isLoading: mocks.permsLoading,
  }),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    user: {
      list: {
        useInfiniteQuery: () => ({
          isLoading: false,
          isError: false,
          hasNextPage: false,
          data: {
            pages: [{ users: [{ id: 'u1', firstName: 'Ana', lastName: 'Ruiz', email: 'ana@x.test', jobTitle: null }] }],
          },
        }),
      },
    },
  },
}));
vi.mock('../../apps/web/lib/platform-api/tenant-invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/lib/platform-api/tenant-invitations')>();
  return {
    ...actual,
    isTenantInvitationsEnabled: () => mocks.enabled,
    useTenantInvitationRoles: () => ({
      isLoading: false,
      isError: false,
      data: [{ slug: 'employee', name: 'Empleado' }],
    }),
    useTenantInvitations: () => ({
      isLoading: false,
      isError: false,
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'pending@x.test',
          roleSlug: 'employee',
          status: 'sent',
          createdAt: '2026-09-20T10:00:00Z',
          expiresAt: '2026-09-27T10:00:00Z',
          sentAt: '2026-09-20T10:00:00Z',
        },
      ],
    }),
    useCreateTenantInvitation: (cb: typeof mocks.createCallbacks) => {
      mocks.createCallbacks = cb;
      return { mutate: mocks.create, isPending: false };
    },
    useResendTenantInvitation: () => ({ mutate: mocks.resend, isPending: false }),
    useRevokeTenantInvitation: () => ({ mutate: mocks.revoke, isPending: false }),
  };
});

import es from '../../apps/web/lib/i18n/es.json';
import TeamSettingsPage from '../../apps/web/app/(admin)/settings/users/page';

const m = es.teamSettings;
beforeEach(() => {
  mocks.enabled = true;
  mocks.canCreate = true;
  mocks.permsLoading = false;
  for (const fn of [mocks.create, mocks.revoke, mocks.resend, mocks.toast]) fn.mockReset();
});

describe('/settings/users (Equipo)', () => {
  it('shows the unavailable state (no form, no pending table) when the flag is off', () => {
    mocks.enabled = false;
    render(<TeamSettingsPage />);
    expect(screen.getByText(m.unavailableTitle)).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.inviteSubmit })).toBeNull();
    expect(screen.queryByText(m.pendingTitle)).toBeNull();
    expect(screen.getByText('ana@x.test')).toBeTruthy(); // members list still renders
  });

  it('shows the no-permission state for a viewer without user:create', () => {
    mocks.canCreate = false;
    render(<TeamSettingsPage />);
    expect(screen.getByText(m.noPermissionTitle)).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.inviteSubmit })).toBeNull();
    expect(screen.queryByText(m.pendingTitle)).toBeNull();
  });

  it('submits {email, roleSlug} only, and warns when delivery is unconfirmed', async () => {
    render(<TeamSettingsPage />);
    fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: 'new@x.test' } });
    fireEvent.change(screen.getByLabelText(m.roleLabel), { target: { value: 'employee' } });
    fireEvent.click(screen.getByRole('button', { name: m.inviteSubmit }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0]).toEqual({ email: 'new@x.test', roleSlug: 'employee' });
    mocks.createCallbacks.onSuccess?.('unconfirmed');
    expect(mocks.toast).toHaveBeenCalledWith(m.invitedUnconfirmed, expect.objectContaining({ type: 'warning' }));
  });

  it('blocks submit with translated validation errors', async () => {
    render(<TeamSettingsPage />);
    fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: m.inviteSubmit }));
    expect(await screen.findByText(m.emailInvalid)).toBeTruthy();
    expect(screen.getByText(m.roleRequired)).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('asks for confirmation before revoking', () => {
    render(<TeamSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: m.revoke }));
    expect(mocks.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: m.confirmRevoke }));
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith('11111111-1111-4111-8111-111111111111');
  });

  it('resends in one click', () => {
    render(<TeamSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: m.resend }));
    expect(mocks.resend).toHaveBeenCalledExactlyOnceWith('11111111-1111-4111-8111-111111111111');
  });
});
