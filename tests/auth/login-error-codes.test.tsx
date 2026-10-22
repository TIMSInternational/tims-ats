import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

// #213 tier-1 (Codex) review: /auth/callback redirects a rejected signup to /login?error=signup_email_invalid,
// but the login page never read the query, so the user saw a bare login form with no explanation.

let query = new URLSearchParams();
let locale: 'ES' | 'EN' = 'ES';
vi.mock('../../apps/web/lib/i18n', () => ({
  useI18n: () => ({ t: locale === 'EN' ? en : es, locale }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => query,
}));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: vi.fn() }));

import LoginPage from '../../apps/web/app/(auth)/login/page';
import { loginErrorMessage } from '../../apps/web/lib/auth/login-error-message';
import { SIGNUP_EMAIL_REJECTED_ERROR } from '../../apps/web/lib/signup-email';

describe('login page explains callback errors', () => {
  it('a rejected signup redirect shows the localized explanation', () => {
    query = new URLSearchParams({ error: SIGNUP_EMAIL_REJECTED_ERROR });
    render(<LoginPage />);
    expect(screen.getByText(es.auth.signupEmailInvalid)).toBeInTheDocument();
  });

  it.each(['no_code', 'auth_callback_error', 'no_email'])('callback failure %s shows the link-expired copy', (code) => {
    query = new URLSearchParams({ error: code });
    render(<LoginPage />);
    expect(screen.getByText(es.auth.authCallbackFailed)).toBeInTheDocument();
  });

  it('never echoes an unknown or hostile code', () => {
    query = new URLSearchParams({ error: '<b>attacker text</b>' });
    render(<LoginPage />);
    expect(screen.queryByText(/attacker text/)).toBeNull();
    expect(loginErrorMessage('<b>attacker text</b>', es.auth)).toBe('');
    expect(loginErrorMessage(null, es.auth)).toBe('');
  });

  it('both locales carry the new copy', () => {
    for (const m of [es.auth, en.auth]) {
      expect(m.signupEmailInvalid.length).toBeGreaterThan(10);
      expect(m.authCallbackFailed.length).toBeGreaterThan(10);
    }
  });

describe('the callback error follows a locale restored after mount (tier-1 r2)', () => {
  it('re-renders in English once the provider switches locale', () => {
    locale = 'ES';
    query = new URLSearchParams({ error: SIGNUP_EMAIL_REJECTED_ERROR });
    const { rerender } = render(<LoginPage />);
    expect(screen.getByText(es.auth.signupEmailInvalid)).toBeInTheDocument();
    locale = 'EN';
    rerender(<LoginPage />);
    expect(screen.getByText(en.auth.signupEmailInvalid)).toBeInTheDocument();
    expect(screen.queryByText(es.auth.signupEmailInvalid)).toBeNull();
    locale = 'ES';
  });
});
