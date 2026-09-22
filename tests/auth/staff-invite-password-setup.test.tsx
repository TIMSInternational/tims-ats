import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams({ setup: '1' }),
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: state.getSession, updateUser: state.updateUser },
  }),
}));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json');
  return { useI18n: () => ({ t }) };
});

import ResetPasswordPage from '../../apps/web/app/(auth)/reset-password/page';

beforeEach(() => {
  state.getSession.mockReset();
  state.updateUser.mockReset();
  state.push.mockReset();
  state.getSession.mockResolvedValue({ data: { session: { access_token: 'invite-session' } }, error: null });
  state.updateUser.mockResolvedValue({ error: null });
});

describe('staff invitation password setup', () => {
  it('waits for the invite session before accepting and updating the password', async () => {
    render(<ResetPasswordPage />);

    const submit = screen.getByRole('button', { name: 'Update password' });
    expect(submit).toBeDisabled();
    await waitFor(() => expect(submit).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-private-staff-password' } });
    fireEvent.click(submit);

    await waitFor(() => expect(state.updateUser).toHaveBeenCalledWith({ password: 'a-private-staff-password' }));
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });

  it('keeps password submission disabled when the invite link has no valid session', async () => {
    state.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<ResetPasswordPage />);

    expect(await screen.findByText('El enlace para establecer la contrasena no es valido o ha expirado')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});
