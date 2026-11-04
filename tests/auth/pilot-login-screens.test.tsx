import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// Pilot auth WP, rendered: SSO hidden in the pilot (E-01), explained bounces (E-01 / E-25), Spanish
// provider errors (E-12), pilot-only login panel + one product name (E-11), SSO busy state and visible
// titles (E-31).

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, refresh: vi.fn() }),
  useSearchParams: () => state.params,
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: state.signInWithPassword,
      signInWithOAuth: state.signInWithOAuth,
      resetPasswordForEmail: state.resetPasswordForEmail,
    },
  }),
}));
vi.mock('../../apps/web/lib/auth/canonical-auth-origin', () => ({
  useCanonicalAuthOrigin: () => undefined,
  ensureCanonicalAuthOrigin: () => true,
}));
vi.mock('@tims/shared', async (original) => ({
  ...(await original<typeof import('@tims/shared')>()),
  getAuthRedirectUrl: () => 'https://app.example/auth/callback?recovery=1',
}));

import LoginPage from '../../apps/web/app/(auth)/login/page';
import ForgotPasswordPage from '../../apps/web/app/(auth)/forgot-password/page';
import { AuthShell } from '../../apps/web/app/(auth)/auth-shell';

beforeEach(() => {
  state.params = new URLSearchParams();
  state.push.mockReset();
  state.signInWithPassword.mockReset();
  state.signInWithOAuth.mockReset();
  state.resetPasswordForEmail.mockReset();
  state.signInWithPassword.mockResolvedValue({ error: null });
  state.signInWithOAuth.mockReturnValue(new Promise(() => undefined)); // provider redirect never resolves
  state.resetPasswordForEmail.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

const fillAndSubmit = () => {
  fireEvent.change(screen.getByLabelText(es.auth.email), { target: { value: 'ana@invu.example' } });
  fireEvent.change(screen.getByLabelText(es.auth.password), { target: { value: 'a-long-password' } });
  fireEvent.click(screen.getByRole('button', { name: es.auth.loginButton }));
};

describe('staff /login', () => {
  it('hides Google / Microsoft in the pilot scope', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    render(<LoginPage />);
    expect(screen.queryByRole('button', { name: es.auth.continueGoogle })).toBeNull();
    expect(screen.queryByRole('button', { name: es.auth.continueMicrosoft })).toBeNull();
    expect(screen.queryByText(es.auth.orWithEmail)).toBeNull();
    expect(screen.getByLabelText(es.auth.email)).toBeInTheDocument();
  });

  it('keeps SSO outside the pilot, and disables both buttons while the redirect starts', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: es.auth.continueGoogle }));
    await waitFor(() => expect(state.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: es.auth.ssoRedirecting })).toBeDisabled();
    expect(screen.getByRole('button', { name: es.auth.continueMicrosoft })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: es.auth.continueMicrosoft }));
    expect(state.signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it('re-enables SSO and shows Spanish copy when the provider start fails', async () => {
    state.signInWithOAuth.mockResolvedValue({
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: es.auth.continueGoogle }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.auth.authNetworkError);
    expect(screen.getByRole('button', { name: es.auth.continueGoogle })).not.toBeDisabled();
  });

  it('explains a sign-in that found no TIMS user', () => {
    state.params = new URLSearchParams({ error: 'no_access' });
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(es.auth.noAccess);
  });

  it('says the session expired, then returns to the original page with its query after sign-in', async () => {
    state.params = new URLSearchParams({ reason: 'expired', redirect: '/recruitment/pipeline?vacancy=v1' });
    render(<LoginPage />);
    expect(screen.getByRole('status')).toHaveTextContent(es.auth.sessionExpired);
    fillAndSubmit();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/recruitment/pipeline?vacancy=v1'));
  });

  it('never follows a backslash host escape after sign-in', async () => {
    state.params = new URLSearchParams({ redirect: '/\\evil.example' });
    render(<LoginPage />);
    fillAndSubmit();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/'));
  });

  it('shows Spanish copy instead of the raw provider message', async () => {
    state.signInWithPassword.mockResolvedValue({
      error: { code: 'over_request_rate_limit', status: 429, message: 'Request rate limit reached' },
    });
    render(<LoginPage />);
    fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(es.auth.authRateLimited);
    expect(screen.queryByText('Request rate limit reached')).toBeNull();
  });

  it('brands the mobile header with the one product name', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'TIMS ATS' })).toBeInTheDocument();
    expect(screen.queryByText('TIMS Platform')).toBeNull();
  });
});

describe('auth side panel', () => {
  it('lists only pilot modules in the pilot scope', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    render(<AuthShell>form</AuthShell>);
    const pills = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(pills).toEqual(['Reclutamiento', 'Entrevistas', 'Ofertas', 'Onboarding']);
    expect(screen.getByText(es.auth.heroTaglinePilot)).toBeInTheDocument();
    expect(screen.queryByText(/evaluaciones predictivas/)).toBeNull();
    expect(screen.getByText('Desarrollado por')).toBeInTheDocument();
    expect(screen.queryByText('Powered by')).toBeNull();
    expect(screen.getByText('TIMS ATS')).toBeInTheDocument();
  });

  it('keeps the full module list outside the pilot', () => {
    render(<AuthShell>form</AuthShell>);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toContain('Nine Box');
  });
});

describe('/forgot-password', () => {
  it('has a visible title and shows a Spanish, announced error for a rate limit', async () => {
    state.resetPasswordForEmail.mockResolvedValue({
      error: {
        code: 'over_email_send_rate_limit',
        status: 429,
        message: 'For security purposes, you can only request this after 60 seconds.',
      },
    });
    render(<ForgotPasswordPage />);
    expect(screen.getByRole('heading', { name: es.auth.recoverPassword })).toBeVisible();
    fireEvent.change(screen.getByLabelText(es.auth.email), { target: { value: 'ana@invu.example' } });
    fireEvent.click(screen.getByRole('button', { name: es.auth.sendLink }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.auth.authRateLimited);
    expect(screen.queryByText(/For security purposes/)).toBeNull();
  });
});
