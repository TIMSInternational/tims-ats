import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  push: vi.fn(),
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

beforeEach(() => {
  window.sessionStorage.clear();
  state.getSession.mockReset();
  state.setSession.mockReset();
  state.updateUser.mockReset();
  state.push.mockReset();
  window.history.replaceState(
    null,
    '',
    '/reset-password?setup=1#access_token=invite-access&refresh_token=invite-refresh&type=invite',
  );
  state.getSession.mockResolvedValue({ data: { session: null }, error: null });
  state.setSession.mockResolvedValue({ data: { session: { access_token: 'invite-access' } }, error: null });
  state.updateUser.mockResolvedValue({ error: null });
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
    state.getSession.mockResolvedValue({ data: { session: { access_token: 'unrelated-session' } }, error: null });
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
});
