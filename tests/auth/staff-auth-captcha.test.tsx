import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// Pilot UX re-audit C-34 (server enforcement): Supabase Auth captcha can only be enabled once every browser call
// it checks sends a Turnstile token. The portal already did; the staff /login, /forgot-password, /register and
// /accept-invitation now do too. Without a site key nothing changes.

const state = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithPassword: state.signInWithPassword, resetPasswordForEmail: state.resetPasswordForEmail },
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
vi.mock('../../apps/web/components/turnstile-widget', () => ({
  TurnstileWidget: ({ onToken }: { onToken: (token: string | null) => void }) => (
    <button type="button" onClick={() => onToken('turnstile-token')}>
      solve-captcha
    </button>
  ),
}));

import { LoginForm } from '../../apps/web/app/(auth)/login/login-form';
import ForgotPasswordPage from '../../apps/web/app/(auth)/forgot-password/page';

beforeEach(() => {
  state.signInWithPassword.mockResolvedValue({ error: null });
  state.resetPasswordForEmail.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function fillLogin() {
  fireEvent.change(screen.getByLabelText(es.auth.email), { target: { value: 'ana@example.test' } });
  fireEvent.change(screen.getByLabelText(es.auth.password), { target: { value: 'a-long-password' } });
}

describe('staff /login captcha', () => {
  it('without a site key: no widget, no token, sign-in unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    render(<LoginForm showSignup={false} />);
    fillLogin();
    expect(screen.queryByText('solve-captcha')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: es.auth.loginButton }));
    });
    expect(state.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@example.test', password: 'a-long-password' });
  });

  it('with a site key: sign-in waits for the widget, then sends the token', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
    render(<LoginForm showSignup={false} />);
    fillLogin();
    expect(screen.getByRole('button', { name: es.auth.loginButton })).toBeDisabled();
    fireEvent.click(screen.getByText('solve-captcha'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: es.auth.loginButton }));
    });
    expect(state.signInWithPassword).toHaveBeenCalledWith({
      email: 'ana@example.test',
      password: 'a-long-password',
      options: { captchaToken: 'turnstile-token' },
    });
  });
});

describe('staff /forgot-password captcha', () => {
  it('sends the token with the reset email', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText(es.auth.email), { target: { value: 'ana@example.test' } });
    fireEvent.click(screen.getByText('solve-captcha'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: es.auth.sendLink }));
    });
    expect(state.resetPasswordForEmail).toHaveBeenCalledWith('ana@example.test', {
      redirectTo: 'https://app.example/auth/callback?recovery=1',
      captchaToken: 'turnstile-token',
    });
  });
});

describe('every browser call Supabase captcha checks carries the token (source pin)', () => {
  const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');
  it.each([
    ['apps/web/app/(auth)/login/login-form.tsx', /signInWithPassword\(\{[\s\S]*?captchaOption/],
    ['apps/web/app/(auth)/forgot-password/page.tsx', /resetPasswordForEmail\(email, \{ redirectTo, \.\.\.captchaOption \}\)/],
    ['apps/web/app/(auth)/register/register-form.tsx', /signUp\(\{[\s\S]*?\.\.\.captchaOption/],
    ['apps/web/app/accept-invitation/use-invitation-setup.ts', /invitationPasswordSignIn\(\{[^}]*\.\.\.options/],
    ['apps/web/app/accept-invitation/invitation-setup-api.ts', /resetPasswordForEmail\(email, \{[\s\S]*?\.\.\.captcha,/],
  ])('%s', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });
});
