// Maps the `?error=` code /auth/callback (or /logout) redirects with onto a staff-login message, and the
// `?reason=` the middleware adds onto an informational notice (null = none shown).
type LoginErrorCopy = {
  readonly callbackError: string;
  readonly registrationClosed: string;
  readonly noAccess: string;
  readonly orgInactive: string;
};

type LoginNoticeCopy = {
  readonly sessionExpired: string;
};

export function loginErrorMessage(code: string | null, copy: LoginErrorCopy): string | null {
  switch (code) {
    case 'auth_callback_error':
    case 'no_code':
    case 'no_email':
      return copy.callbackError;
    case 'registration_closed':
      return copy.registrationClosed;
    // A sign-in (Google / Microsoft, or a session that is not a TIMS staff account) that found no
    // active TIMS user: the session was cleared on /logout, say why instead of a silent bounce.
    case 'no_access':
      return copy.noAccess;
    // A staff account whose organization was deactivated (platform-owner access-3).
    case 'org_inactive':
      return copy.orgInactive;
    default:
      return null;
  }
}

export function loginNoticeMessage(reason: string | null, copy: LoginNoticeCopy): string | null {
  return reason === 'expired' ? copy.sessionExpired : null;
}
