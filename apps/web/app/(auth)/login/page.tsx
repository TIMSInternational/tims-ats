import { Suspense } from 'react';
import { isSelfServeSignupEnabled } from '../../../lib/self-serve-signup';
import { LoginForm } from './login-form';

// Read SELF_SERVE_SIGNUP_ENABLED per request (not at build) so the link agrees with /auth/callback.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm showSignup={isSelfServeSignupEnabled()} />
    </Suspense>
  );
}
