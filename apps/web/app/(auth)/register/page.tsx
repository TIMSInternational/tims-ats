import { isSelfServeSignupEnabled } from '../../../lib/self-serve-signup';
import { RegisterChooser } from './register-chooser';
import { RegistrationClosed } from './registration-closed';

// Read SELF_SERVE_SIGNUP_ENABLED per request (not at build) so this page agrees with /auth/callback.
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return isSelfServeSignupEnabled() ? <RegisterChooser /> : <RegistrationClosed />;
}
