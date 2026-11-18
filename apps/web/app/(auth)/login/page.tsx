import type { Metadata } from 'next';
import es from '../../../lib/i18n/es.json';
import { Suspense } from 'react';
import { isSelfServeSignupEnabled } from '../../../lib/self-serve-signup';
import { LoginForm } from './login-form';

// Read SELF_SERVE_SIGNUP_ENABLED per request (not at build) so the link agrees with /auth/callback.
export const dynamic = 'force-dynamic';

// A tab title per step, not the bare product name (toolbars.md › Titles). Spanish: the default locale.
export const metadata: Metadata = { title: `${es.auth.login} · ${es.auth.platformName}` };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm showSignup={isSelfServeSignupEnabled()} />
    </Suspense>
  );
}
