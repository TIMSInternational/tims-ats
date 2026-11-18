import type { Metadata } from 'next';
import es from '../../../lib/i18n/es.json';
import { isSelfServeSignupEnabled } from '../../../lib/self-serve-signup';
import { RegisterChooser } from './register-chooser';
import { RegistrationClosed } from './registration-closed';

// Read SELF_SERVE_SIGNUP_ENABLED per request (not at build) so this page agrees with /auth/callback.
export const dynamic = 'force-dynamic';

// A tab title per step, not the bare product name (toolbars.md › Titles). Spanish: the default locale.
export const metadata: Metadata = { title: `${es.auth.register} · ${es.auth.platformName}` };

export default function RegisterPage() {
  return isSelfServeSignupEnabled() ? <RegisterChooser /> : <RegistrationClosed />;
}
