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
  signOut: vi.fn(),
  setSession: vi.fn(),
  sharedSignIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ token }) }));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: state.getSession,
      setSession: state.setSession,
      // The page must never sign in on the browser's shared client (that would overwrite another tab's sign-in).
      signInWithPassword: state.sharedSignIn,
      resetPasswordForEmail: state.recover,
      signInWithOAuth: state.oauth,
      signOut: state.signOut,
    },
  }),
}));
vi.mock('../../apps/web/app/accept-invitation/invitation-setup-api', async (original) => {
  const actual = await original<typeof import('../../apps/web/app/accept-invitation/invitation-setup-api')>();
  return {
    ...actual,
    setupRequest: state.request,
    invitationSocialSignIn: state.oauth,
    invitationPasswordSignIn: state.signIn,
  };
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
  state.signOut.mockReset();
  state.setSession.mockReset();
  state.sharedSignIn.mockReset();
  state.signOut.mockResolvedValue({ error: null });
  state.setSession.mockResolvedValue({ data: {}, error: null });
  delete process.env.NEXT_PUBLIC_LAUNCH_SCOPE;
  state.request.mockImplementation((action: string) =>
    action === 'preview'
      ? Promise.resolve(invitation)
      : Promise.resolve({ outcome: action === 'register' ? 'account_created' : 'complete' }),
  );
  state.getSession.mockResolvedValue({ data: { session: null } });
  state.signIn.mockResolvedValue({
    data: { session: { access_token: 'fresh-token', refresh_token: 'fresh-refresh' } },
    error: null,
  });
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
    // Adopted into the browser only after the API accepted it, never signed in on the shared client.
    expect(state.setSession).toHaveBeenCalledWith({ access_token: 'fresh-token', refresh_token: 'fresh-refresh' });
    expect(state.sharedSignIn).not.toHaveBeenCalled();
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
    expect(state.setSession).not.toHaveBeenCalled();
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

  it('recovers the controls when the OAuth provider throws before redirecting', async () => {
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, accountExists: true })
        : Promise.resolve({ outcome: 'complete' }),
    );
    state.oauth.mockRejectedValue(new Error('provider unavailable'));
    render(<InvitationSetup />);
    await screen.findByText('TIMS Test');
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos completar');
    expect(screen.getByRole('button', { name: 'Google' })).not.toBeDisabled();
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
    // /mfa runs on the browser's session, so the accepted sign-in is adopted before leaving.
    expect(state.setSession).toHaveBeenCalledWith({ access_token: 'fresh-token', refresh_token: 'fresh-refresh' });
    assign.mockRestore();
  });

  it('names the role by its label, never the raw slug (D-06)', async () => {
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, roleSlug: 'super_admin' })
        : Promise.resolve({ outcome: 'complete' }),
    );
    render(<InvitationSetup />);
    expect(await screen.findByText('Super Administrador')).toBeInTheDocument();
    expect(screen.queryByText('super admin')).not.toBeInTheDocument();
  });

  it('tells a super administrator that two-step verification comes next (D-06)', async () => {
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, roleSlug: 'super_admin' })
        : Promise.resolve({ outcome: action === 'register' ? 'account_created' : 'complete' }),
    );
    render(<InvitationSetup />);
    await screen.findByText('TIMS Test');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Apellido'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
    await screen.findByText('Tu acceso está listo');
    expect(screen.getByText(/verificación en dos pasos/)).toBeInTheDocument();
  });

  it('does not mention two-step verification for a role that does not require it', async () => {
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
    await screen.findByText('Tu acceso está listo');
    expect(screen.queryByText(/verificación en dos pasos/)).not.toBeInTheDocument();
  });

  it('a failed load is retryable and is not reported as an unavailable invitation (D-06 / E-19)', async () => {
    let calls = 0;
    state.request.mockImplementation((action: string) => {
      if (action !== 'preview') return Promise.resolve({ outcome: 'complete' });
      calls += 1;
      return calls === 1
        ? Promise.reject(new SetupRequestError('setup_unavailable', 503))
        : Promise.resolve(invitation);
    });
    render(<InvitationSetup />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos verificar tu invitación');
    expect(screen.queryByText(/no está disponible/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('TIMS Test')).toBeInTheDocument();
  });

  it('a network failure is retryable too', async () => {
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve({ outcome: 'complete' }),
    );
    render(<InvitationSetup />);
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('an unknown token (404) is unavailable, with no retry', async () => {
    state.request.mockImplementation(() => Promise.reject(new SetupRequestError('setup_unavailable', 404)));
    render(<InvitationSetup />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no está disponible');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('warns before replacing another signed-in account, and signs it out of this browser only (E-19)', async () => {
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'admin-token', user: { email: 'admin@example.test' } } },
    });
    render(<InvitationSetup />);
    expect(await screen.findByRole('alert')).toHaveTextContent('admin@example.test');
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear cuenta y unirme' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar esa sesión y continuar' }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(await screen.findByRole('button', { name: 'Crear cuenta y unirme' })).toBeInTheDocument();
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it('a session the API does not accept reveals password and recovery again (E-02)', async () => {
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'sso-token', user: { email: invitation.email } } },
    });
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, accountExists: true })
        : Promise.resolve({ outcome: 'sign_in_required' }),
    );
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar acceso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa o recupera tu acceso');
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recuperar acceso' })).toBeInTheDocument();
  });

  it('pilot: hides Google / Microsoft and explains how to get in without them (E-02)', async () => {
    process.env.NEXT_PUBLIC_LAUNCH_SCOPE = 'pilot';
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, accountExists: true })
        : Promise.resolve({ outcome: 'complete' }),
    );
    render(<InvitationSetup />);
    await screen.findByText('TIMS Test');
    expect(screen.getByRole('button', { name: 'Recuperar acceso' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Google' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Microsoft' })).not.toBeInTheDocument();
    expect(screen.getByText(/nunca creaste una/)).toBeInTheDocument();
  });

  it('after a rejected session, the next submit signs in with the entered password (E-02, review fix)', async () => {
    let session: { access_token: string; user: { email: string } } | null = {
      access_token: 'rejected-token',
      user: { email: invitation.email },
    };
    state.getSession.mockImplementation(async () => ({ data: { session } }));
    let completes = 0;
    state.request.mockImplementation((action: string) => {
      if (action === 'preview') return Promise.resolve({ ...invitation, accountExists: true });
      completes += 1;
      return Promise.resolve({ outcome: completes === 1 ? 'sign_in_required' : 'complete' });
    });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar acceso' }));
    await screen.findByLabelText('Contraseña');
    // Nothing is signed out (another tab may have signed in meanwhile); the refused token is just never reused.
    expect(state.signOut).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'the-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y unirme' }));
    await screen.findByText('Tu acceso está listo');
    expect(state.signIn).toHaveBeenCalledWith({ email: invitation.email, password: 'the-real-password' });
    expect(state.request).toHaveBeenLastCalledWith('complete', expect.any(Object), 'fresh-token');
    // The accepted sign-in replaces the invitee's own refused session in the browser.
    expect(state.setSession).toHaveBeenCalledWith({ access_token: 'fresh-token', refresh_token: 'fresh-refresh' });
  });

  it('never reuses a rejected token, however many times the browser still offers it', async () => {
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'rejected-token', user: { email: invitation.email } } },
    });
    let completes = 0;
    state.request.mockImplementation((action: string) => {
      if (action === 'preview') return Promise.resolve({ ...invitation, accountExists: true });
      completes += 1;
      return Promise.resolve({ outcome: completes === 1 ? 'sign_in_required' : 'complete' });
    });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar acceso' }));
    fireEvent.change(await screen.findByLabelText('Contraseña'), { target: { value: 'the-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y unirme' }));
    await screen.findByText('Tu acceso está listo');
    expect(state.signIn).toHaveBeenCalledOnce();
    expect(state.request).toHaveBeenLastCalledWith('complete', expect.any(Object), 'fresh-token');
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it('warns again when another account signed in after the page loaded (E-19, review fix)', async () => {
    state.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 'other-token', user: { email: 'other@example.test' } } } });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('other@example.test');
    expect(state.request).not.toHaveBeenCalledWith('register', expect.anything());
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it('does not start SSO over another account that signed in after the page loaded', async () => {
    state.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 'other-token', user: { email: 'other@example.test' } } } });
    state.request.mockImplementation((action: string) =>
      action === 'preview'
        ? Promise.resolve({ ...invitation, accountExists: true })
        : Promise.resolve({ outcome: 'complete' }),
    );
    render(<InvitationSetup />);
    await screen.findByText('TIMS Test');
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('other@example.test');
    expect(state.oauth).not.toHaveBeenCalled();
  });

  it('does not sign in over an account that signed in while registration was in flight (review round 2)', async () => {
    type FakeSession = { access_token: string; user: { email: string } };
    let session: FakeSession | null = null;
    state.getSession.mockImplementation(async () => ({ data: { session } }));
    state.request.mockImplementation(async (action: string) => {
      if (action === 'preview') return invitation;
      if (action === 'register') {
        session = { access_token: 'other-token', user: { email: 'other@example.test' } }; // another tab
        return { outcome: 'account_created' };
      }
      return { outcome: 'complete' };
    });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('other@example.test');
    expect(state.signIn).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalledWith('complete', expect.anything(), expect.anything());
  });

  it('after sign_in_required, does not sign out an account that signed in during that request (review round 2)', async () => {
    type FakeSession = { access_token: string; user: { email: string } };
    let session: FakeSession | null = { access_token: 'sso-token', user: { email: invitation.email } };
    state.getSession.mockImplementation(async () => ({ data: { session } }));
    state.request.mockImplementation(async (action: string) => {
      if (action === 'preview') return { ...invitation, accountExists: true };
      session = { access_token: 'other-token', user: { email: 'other@example.test' } }; // another tab
      return { outcome: 'sign_in_required' };
    });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar acceso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa o recupera tu acceso');
    expect(state.signOut).not.toHaveBeenCalled();
  });

  // Review round 3: the authentication requests themselves are deferred here, and another tab signs in while
  // they are in flight. The browser's session must end up as that other account in every case.
  type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
  function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }
  const other = { access_token: 'other-token', user: { email: 'other@example.test' } };
  const fresh = { data: { session: { access_token: 'fresh-token', refresh_token: 'fresh-refresh' } }, error: null };

  async function submitNewAccount() {
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'a-long-private-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
  }

  it('a sign-in from another tab during the password sign-in is not overwritten (review round 3)', async () => {
    let session: typeof other | null = null;
    state.getSession.mockImplementation(async () => ({ data: { session } }));
    const signIn = deferred<typeof fresh>();
    state.signIn.mockReturnValue(signIn.promise);
    render(<InvitationSetup />);
    await submitNewAccount();
    await waitFor(() => expect(state.signIn).toHaveBeenCalledOnce());
    session = other; // another tab signs in while the invitee's sign-in is in flight
    signIn.resolve(fresh);
    await screen.findByText('Tu acceso está listo');
    expect(state.request).toHaveBeenCalledWith('complete', expect.any(Object), 'fresh-token');
    expect(state.setSession).not.toHaveBeenCalled();
    expect(state.sharedSignIn).not.toHaveBeenCalled();
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it('a sign-in from another tab while the API is accepting is not overwritten (review round 3)', async () => {
    let session: typeof other | null = null;
    state.getSession.mockImplementation(async () => ({ data: { session } }));
    const completion = deferred<{ outcome: string }>();
    state.request.mockImplementation((action: string) => {
      if (action === 'preview') return Promise.resolve(invitation);
      if (action === 'register') return Promise.resolve({ outcome: 'account_created' });
      return completion.promise;
    });
    render(<InvitationSetup />);
    await submitNewAccount();
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('complete', expect.any(Object), 'fresh-token'));
    session = other;
    completion.resolve({ outcome: 'complete' });
    await screen.findByText('Tu acceso está listo');
    expect(state.setSession).not.toHaveBeenCalled();
  });

  it('a refused password sign-in is never stored and nothing is signed out (review round 3)', async () => {
    let session: typeof other | null = null;
    state.getSession.mockImplementation(async () => ({ data: { session } }));
    const completion = deferred<{ outcome: string }>();
    state.request.mockImplementation((action: string) => {
      if (action === 'preview') return Promise.resolve({ ...invitation, accountExists: true });
      return completion.promise;
    });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'current-credential' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y unirme' }));
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('complete', expect.any(Object), 'fresh-token'));
    session = other;
    completion.resolve({ outcome: 'sign_in_required' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa o recupera tu acceso');
    expect(state.setSession).not.toHaveBeenCalled();
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it('MFA: does not adopt the session over an account that signed in meanwhile (review round 3)', async () => {
    let session: typeof other | null = null;
    state.getSession.mockImplementation(async () => ({ data: { session } }));
    state.request.mockImplementation(async (action: string) => {
      if (action === 'preview') return { ...invitation, accountExists: true };
      session = other; // another tab, during the completion request
      throw new SetupRequestError('mfa_required');
    });
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'current-credential' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y unirme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('other@example.test');
    expect(state.setSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it('checks for another account after the API accepted and immediately before adopting (review round 4)', async () => {
    // What remains possible, and is documented in adopt(): a sign-in from another tab DURING setSession's own
    // user lookup is still replaced (Supabase's cookie storage has no compare-and-set). This pins the check as
    // late as the SDK allows: after the completion request, with nothing else awaited before setSession.
    render(<InvitationSetup />);
    await submitNewAccount();
    await screen.findByText('Tu acceso está listo');
    const completeOrder = state.request.mock.invocationCallOrder[state.request.mock.calls.length - 1];
    const lastCheck = Math.max(...state.getSession.mock.invocationCallOrder);
    const [adoptOrder] = state.setSession.mock.invocationCallOrder;
    expect(state.request.mock.calls.at(-1)?.[0]).toBe('complete');
    expect(lastCheck).toBeGreaterThan(completeOrder);
    expect(adoptOrder).toBe(lastCheck + 1);
  });

  it('never reuses an earlier refused token after a second refusal (review round 4)', async () => {
    // The browser keeps holding refused token A while an isolated sign-in (B) is refused too.
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'browser-token-a', user: { email: invitation.email } } },
    });
    let signIns = 0;
    state.signIn.mockImplementation(async () => {
      signIns += 1;
      return { data: { session: { access_token: `isolated-token-${signIns}`, refresh_token: 'r' } }, error: null };
    });
    let completes = 0;
    state.request.mockImplementation((action: string) => {
      if (action === 'preview') return Promise.resolve({ ...invitation, accountExists: true });
      completes += 1;
      return Promise.resolve({ outcome: completes < 3 ? 'sign_in_required' : 'complete' });
    });
    render(<InvitationSetup />);
    await fillProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Completar acceso' }));
    for (const attempt of [1, 2]) {
      fireEvent.change(await screen.findByLabelText('Contraseña'), { target: { value: `password-${attempt}` } });
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y unirme' }));
      await waitFor(() => expect(state.signIn).toHaveBeenCalledTimes(attempt));
    }
    await screen.findByText('Tu acceso está listo');
    const tokens = state.request.mock.calls.filter(([action]) => action === 'complete').map((call) => call[2]);
    expect(tokens).toEqual(['browser-token-a', 'isolated-token-1', 'isolated-token-2']);
    expect(state.signIn).toHaveBeenLastCalledWith({ email: invitation.email, password: 'password-2' });
  });

  it('a failed adoption still shows access granted, since the API already accepted it', async () => {
    state.setSession.mockResolvedValue({ data: {}, error: new Error('network') });
    render(<InvitationSetup />);
    await submitNewAccount();
    expect(await screen.findByText('Tu acceso está listo')).toBeInTheDocument();
  });
});
