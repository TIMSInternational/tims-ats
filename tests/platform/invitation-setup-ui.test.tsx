import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const token = '11111111-1111-4111-8111-111111111111';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  getSession: vi.fn(),
  signIn: vi.fn(),
  recover: vi.fn(),
  oauth: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ token }) }));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: state.getSession,
      signInWithPassword: state.signIn,
      resetPasswordForEmail: state.recover,
      signInWithOAuth: state.oauth,
    },
  }),
}));
vi.mock('../../apps/web/app/accept-invitation/invitation-setup-api', async (original) => {
  const actual = await original<typeof import('../../apps/web/app/accept-invitation/invitation-setup-api')>();
  return { ...actual, setupRequest: state.request, invitationSocialSignIn: state.oauth };
});

import { InvitationSetup } from '../../apps/web/app/accept-invitation/invitation-setup';
import { SetupRequestError } from '../../apps/web/app/accept-invitation/invitation-setup-api';

const invitation = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'invitee@example.test',
  organizationId: '33333333-3333-4333-8333-333333333333',
  organizationName: 'TIMS Test',
  roleSlug: 'recruiter',
  status: 'sent',
  expiresAt: '2099-01-01T00:00:00Z',
  accountExists: false,
  setupCompleted: false,
};

beforeEach(() => {
  state.request.mockReset();
  state.getSession.mockReset();
  state.signIn.mockReset();
  state.recover.mockReset();
  state.oauth.mockReset();
  state.request.mockImplementation((action: string) =>
    action === 'preview'
      ? Promise.resolve(invitation)
      : Promise.resolve({ outcome: action === 'register' ? 'account_created' : 'complete' }),
  );
  state.getSession.mockResolvedValue({ data: { session: null } });
  state.signIn.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } }, error: null });
  state.recover.mockResolvedValue({ error: null });
  state.oauth.mockResolvedValue({ error: null });
});

async function fillProfile() {
  await screen.findByText('TIMS Test');
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Test' } });
  fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: 'Recipient' } });
}

describe('invitation account setup', () => {
  it('creates an identity, authenticates it, and finalizes tenant access', async () => {
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));

    await screen.findByText('Tu acceso está listo');
    expect(state.request).toHaveBeenCalledWith('register', { token, password: 'a-long-private-secret' });
    expect(state.signIn).toHaveBeenCalledWith({ email: invitation.email, password: 'a-long-private-secret' });
    expect(state.request).toHaveBeenCalledWith(
      'complete',
      {
        token,
        firstName: 'Test',
        lastName: 'Recipient',
      },
      'fresh-token',
    );
  });

  it('uses the latest matching session and never asks for its credential again', async () => {
    state.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'resumed-token',
          user: { email: invitation.email },
        },
      },
    });
    render(<InvitationSetup />);
    await fillProfile();
    await waitFor(() => expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Completar acceso' }));
    await screen.findByText('Tu acceso está listo');
    expect(state.signIn).not.toHaveBeenCalled();
    expect(state.request).toHaveBeenCalledWith('complete', expect.any(Object), 'resumed-token');
  });

  it('requires the invited email when an existing-account sign-in fails', async () => {
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, accountExists: true })
        : Promise.resolve({ outcome: 'complete' }),
    );
    state.signIn.mockResolvedValue({ data: { session: null }, error: new Error('invalid') });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'wrong-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y unirme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa o recupera tu acceso');
    expect(state.request).not.toHaveBeenCalledWith('complete', expect.anything(), expect.anything());
  });

  it('reveals sign-in and recovery controls when a previously detected session disappears', async () => {
    state.getSession
      .mockResolvedValueOnce({ data: { session: { access_token: 'old-token', user: { email: invitation.email } } } })
      .mockResolvedValueOnce({ data: { session: null } });
    state.signIn.mockResolvedValue({ data: { session: null }, error: new Error('expired') });
    render(<InvitationSetup />);
    await fillProfile();
    await screen.findByRole('button', { name: 'Completar acceso' });
    fireEvent.click(screen.getByRole('button', { name: 'Completar acceso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa o recupera tu acceso');
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recuperar acceso' })).toBeInTheDocument();
  });

  it('reports recovery provider failure and starts OAuth with the invitation return token', async () => {
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, accountExists: true })
        : Promise.resolve({ outcome: 'complete' }),
    );
    state.recover.mockResolvedValue({ error: new Error('mail unavailable') });
    render(<InvitationSetup />);
    await screen.findByText('TIMS Test');
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acceso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos completar');
    expect(screen.queryByText('recibirás un enlace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    await waitFor(() => expect(state.oauth).toHaveBeenCalledWith('google', token));
  });

  it('does not reopen a legacy accepted invitation without completion evidence', async () => {
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, status: 'accepted', setupCompleted: false })
        : Promise.resolve({ outcome: 'complete' }),
    );
    render(<InvitationSetup />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no está disponible');
    expect(screen.queryByRole('button', { name: 'Crear cuenta y unirme' })).not.toBeInTheDocument();
  });

  it('sends a privileged recipient to MFA and preserves the invitation return path', async () => {
    state.request.mockImplementation((action: string) => {
      if (action === 'preview') return Promise.resolve({ ...invitation, accountExists: true });
      if (action === 'complete') return Promise.reject(new SetupRequestError('mfa_required'));
      return Promise.resolve({ outcome: 'complete' });
    });
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'current-credential' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y unirme' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/mfa?returnTo=${encodeURIComponent(`/accept-invitation?token=${token}`)}`),
    );
  });
});
