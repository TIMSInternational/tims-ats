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
  useSearchParams: () => new URLSearchParams({ setup: '1' }),
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

    await waitFor(() => expect(state.updateUser).toHaveBeenCalledWith({ password: 'a-private-staff-password' }));
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });

  it('keeps password submission disabled when the invite link has no valid session', async () => {
    window.history.replaceState(null, '', '/reset-password?setup=1');
    state.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<ResetPasswordPage />);

    expect(await screen.findByText('The password setup link is invalid or has expired')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
    expect(state.updateUser).not.toHaveBeenCalled();
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
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
  });
});
