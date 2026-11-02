// Maps the `?error=` code /auth/callback redirects with onto a staff-login message (null = none shown).
type LoginErrorCopy = {
  readonly callbackError: string;
  readonly registrationClosed: string;
};

export function loginErrorMessage(code: string | null, copy: LoginErrorCopy): string | null {
  switch (code) {
    case 'auth_callback_error':
    case 'no_code':
    case 'no_email':
      return copy.callbackError;
    case 'registration_closed':
      return copy.registrationClosed;
    default:
      return null;
  }
}
