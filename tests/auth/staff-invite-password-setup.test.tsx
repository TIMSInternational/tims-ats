import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  push: vi.fn(),
  verifyProof: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  // Follows the test's URL (set with history.replaceState) so `?invitation=` reaches the page.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: state.getSession, setSession: state.setSession, updateUser: state.updateUser },
  }),
}));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json');
  return { useI18n: () => ({ t }) };
});

import ResetPasswordPage from '../../apps/web/app/(auth)/reset-password/page';

const invitedUserId = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  window.sessionStorage.clear();
  state.getSession.mockReset();
  state.setSession.mockReset();
  state.updateUser.mockReset();
  state.push.mockReset();
  state.verifyProof.mockReset();
  vi.stubGlobal('fetch', state.verifyProof);
  window.history.replaceState(
    null,
    '',
    '/reset-password?setup=1#access_token=invite-access&refresh_token=invite-refresh&type=invite',
  );
  state.getSession.mockResolvedValue({
    data: { session: { access_token: 'invite-access', user: { id: invitedUserId } } },
    error: null,
  });
  state.setSession.mockResolvedValue({
    data: { session: { access_token: 'invite-access', user: { id: invitedUserId } } },
    error: null,
  });
  state.updateUser.mockResolvedValue({ error: null });
  state.verifyProof.mockResolvedValue({ ok: true, json: async () => ({ valid: true, userId: invitedUserId }) });
});

describe('staff invitation password setup', () => {
  it('waits for the invite session before accepting and updating the password', async () => {
    render(
      <React.StrictMode>
        <ResetPasswordPage />
      </React.StrictMode>,
    );

    const submit = screen.getByRole('button', { name: 'Update password' });
    expect(submit).toBeDisabled();
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(state.setSession).toHaveBeenCalledWith({
      access_token: 'invite-access',
      refresh_token: 'invite-refresh',
    });
    expect(window.location.hash).toBe('');
    expect(state.getSession).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(state.verifyProof).toHaveBeenCalledWith('/api/auth/password-update', {
        method: 'POST',
        headers: { authorization: 'Bearer invite-access', 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'a-private-staff-password', userId: invitedUserId }),
        cache: 'no-store',
      }),
    );
    expect(state.updateUser).not.toHaveBeenCalled();
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });

  it('replaces the form with a way out when the invite link has no valid session (E-05)', async () => {
    window.history.replaceState(null, '', '/reset-password?setup=1');
    state.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<ResetPasswordPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking the link…');
    expect(await screen.findByRole('alert')).toHaveTextContent('The password setup link is invalid or has expired');
    expect(screen.queryByRole('button', { name: 'Update password' })).toBeNull();
    expect(screen.queryByLabelText('New password')).toBeNull();
    // Both exits sign out first: a session can outlive a spent link, and middleware bounces a signed-in
    // user off /forgot-password and /login (tests/auth/login-redirect-middleware.test.ts).
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/logout?next=/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/logout');
    expect(screen.queryByRole('status')).toBeNull();
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it('sends an invalid invitation recovery link back to that invitation, not to a generic reset', async () => {
    const invitation = '11111111-1111-4111-8111-111111111111';
    window.history.replaceState(null, '', `/reset-password?invitation=${invitation}#error=access_denied`);
    render(<ResetPasswordPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The password setup link is invalid or has expired');
    expect(screen.getByRole('link', { name: 'Back to the invitation' })).toHaveAttribute(
      'href',
      `/accept-invitation?token=${invitation}`,
    );
    expect(screen.queryByRole('link', { name: 'Request a new link' })).toBeNull();
  });

  it('accepts a valid implicit recovery fragment on the shared password page', async () => {
    window.history.replaceState(
      null,
      '',
      '/reset-password#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery',
    );
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Update password' })).not.toBeDisabled());
    expect(state.setSession).toHaveBeenCalledWith({
      access_token: 'recovery-access',
      refresh_token: 'recovery-refresh',
    });
    expect(window.location.hash).toBe('');
  });

  it('rejects provider error fragments even when another account has a session', async () => {
    window.history.replaceState(null, '', '/reset-password?setup=1#error=access_denied&error_code=otp_expired');
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'unrelated-session', user: { id: '55555555-5555-4555-8555-555555555555' } } },
      error: null,
    });
    const page = render(<ResetPasswordPage />);

    expect(await screen.findByText('The password setup link is invalid or has expired')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Update password' })).toBeNull();
    expect(state.getSession).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');

    page.unmount();
    render(<ResetPasswordPage />);
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
    expect(state.getSession).not.toHaveBeenCalled();
  });

  it('rejects residual PKCE codes instead of trusting an ambient account session', async () => {
    window.history.replaceState(null, '', '/reset-password?code=expired-code');
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'unrelated-session', user: { id: '55555555-5555-4555-8555-555555555555' } } },
      error: null,
    });
    const page = render(<ResetPasswordPage />);

    expect(await screen.findByText('The password setup link is invalid or has expired')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Update password' })).toBeNull();
    expect(state.getSession).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');

    page.unmount();
    render(<ResetPasswordPage />);
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
    expect(state.getSession).not.toHaveBeenCalled();
  });

  it('clears an earlier rejection only after a server-bound recovery proof succeeds', async () => {
    const invitation = '11111111-1111-4111-8111-111111111111';
    const proof = '22222222-2222-4222-8222-222222222222';
    window.history.replaceState(
      null,
      '',
      `/reset-password?invitation=${invitation}#error=access_denied&error_code=otp_expired`,
    );
    const rejected = render(<ResetPasswordPage />);
    expect(await screen.findByText('The password setup link is invalid or has expired')).toBeVisible();
    rejected.unmount();

    window.history.replaceState(null, '', `/reset-password?invitation=${invitation}&recovery=${proof}`);
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'server-exchanged-session', user: { id: invitedUserId } } },
      error: null,
    });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Update password' })).not.toBeDisabled());
    expect(state.verifyProof).toHaveBeenCalledWith(`/api/auth/password-setup?nonce=${proof}`, {
      method: 'POST',
      cache: 'no-store',
    });
    expect(window.location.search).toBe(`?invitation=${invitation}`);
  });

  it('rejects a recovery proof when the browser session belongs to another account', async () => {
    const proof = '22222222-2222-4222-8222-222222222222';
    window.history.replaceState(null, '', `/reset-password?recovery=${proof}`);
    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'other-session', user: { id: '55555555-5555-4555-8555-555555555555' } } },
      error: null,
    });
    render(<ResetPasswordPage />);

    expect(await screen.findByText('The password setup link is invalid or has expired')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Update password' })).toBeNull();
  });

  it('rechecks the account identity immediately before changing the password', async () => {
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update password' })).not.toBeDisabled());

    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'switched-session', user: { id: '55555555-5555-4555-8555-555555555555' } } },
      error: null,
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('The password setup link is invalid or has expired')).toBeVisible();
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it('binds the update request to the access token captured by validation', async () => {
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update password' })).not.toBeDisabled());
    state.verifyProof.mockImplementation(async (url: string) => {
      if (url === '/api/auth/password-update') {
        state.getSession.mockResolvedValue({
          data: {
            session: {
              access_token: 'switched-session',
              user: { id: '55555555-5555-4555-8555-555555555555' },
            },
          },
          error: null,
        });
      }
      return { ok: true, json: async () => ({ valid: true, userId: invitedUserId }) };
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(screen.getByText('Password updated')).toBeInTheDocument());
    expect(state.verifyProof).toHaveBeenCalledWith(
      '/api/auth/password-update',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer invite-access' }) }),
    );
  });

  it('shows a retryable error and re-enables submission after a network failure', async () => {
    render(<ResetPasswordPage />);
    const submit = screen.getByRole('button', { name: 'Update password' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    state.verifyProof.mockRejectedValueOnce(new TypeError('network unavailable'));

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.click(submit);

    expect(
      await screen.findByText('We could not update your password. Request a new link and try again.'),
    ).toBeVisible();
    expect(submit).not.toBeDisabled();
  });

  it('steps up MFA and preserves the authorized password setup return path', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    render(<ResetPasswordPage />);
    const submit = screen.getByRole('button', { name: 'Update password' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    state.verifyProof.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'mfa_required' }),
    });

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.click(submit);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/mfa?returnTo=%2Freset-password%3Fsetup%3D1'));
    expect(window.sessionStorage.getItem('tims-password-setup-user:/reset-password?setup=1')).toBe(invitedUserId);
  });

  it('does not rebind a verified recovery to a different account after reload', async () => {
    const proof = '22222222-2222-4222-8222-222222222222';
    window.history.replaceState(null, '', `/reset-password?recovery=${proof}`);
    const verified = render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update password' })).not.toBeDisabled());
    verified.unmount();

    state.getSession.mockResolvedValue({
      data: { session: { access_token: 'switched-session', user: { id: '55555555-5555-4555-8555-555555555555' } } },
      error: null,
    });
    render(<ResetPasswordPage />);

    expect(await screen.findByText('The password setup link is invalid or has expired')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Update password' })).toBeNull();
  });
});
