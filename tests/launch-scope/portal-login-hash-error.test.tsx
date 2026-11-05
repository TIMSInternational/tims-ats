import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { hasAuthErrorFragment } from '../../apps/web/lib/portal-auth';

// Supabase can report an expired / used portal magic link ONLY in the URL fragment
// (#error=access_denied&error_code=otp_expired), which /auth/callback never sees. The portal login page
// must show the same expired-link message it shows for ?error=link.

const nav = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'invu' }),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../packages/auth/src/client', () => ({ createSupabaseBrowserClient: vi.fn() }));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: vi.fn() }));
vi.mock('../../apps/web/lib/auth/canonical-auth-origin', () => ({
  ensureCanonicalAuthOrigin: () => true,
  useCanonicalAuthOrigin: () => undefined,
}));

import PortalLoginPage from '../../apps/web/app/(portal)/careers/[orgSlug]/login/page';

afterEach(() => {
  cleanup();
  nav.search = '';
  window.history.replaceState(null, '', '/careers/invu/login');
});

describe('hasAuthErrorFragment', () => {
  it('detects error / error_code in the fragment, with or without the leading #', () => {
    expect(hasAuthErrorFragment('#error=access_denied&error_code=otp_expired&error_description=x')).toBe(true);
    expect(hasAuthErrorFragment('error_code=otp_expired')).toBe(true);
    expect(hasAuthErrorFragment('#access_token=abc&type=magiclink')).toBe(false);
    expect(hasAuthErrorFragment('')).toBe(false);
    expect(hasAuthErrorFragment(undefined)).toBe(false);
  });
});

describe('portal login page expired-link message', () => {
  it('shows the expired-link message for a #error fragment and strips the fragment', () => {
    window.history.replaceState(null, '', '/careers/invu/login#error=access_denied&error_code=otp_expired');
    render(<PortalLoginPage />);
    expect(screen.getByRole('alert').textContent).toBe(en.portalAuth.linkExpired);
    expect(window.location.hash).toBe('');
  });

  it('still shows it for ?error=link', () => {
    nav.search = 'error=link';
    render(<PortalLoginPage />);
    expect(screen.getByRole('alert').textContent).toBe(en.portalAuth.linkExpired);
  });

  it('shows nothing on a clean load', () => {
    window.history.replaceState(null, '', '/careers/invu/login');
    render(<PortalLoginPage />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
