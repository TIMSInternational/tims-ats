// Whether the staff auth screens offer "Continuar con Google / Microsoft".
//
// Hidden in the pilot launch scope (NEXT_PUBLIC_LAUNCH_SCOPE=pilot): pilot accounts are created by
// invitation with an email + password, and an SSO sign-in that does not match an accepted invitation
// has nowhere to go (it is signed out again on /auth/callback). Flip this ONE function to offer SSO
// again once invitation → SSO linking is designed. UX only: /auth/callback stays the enforcement point.
import { readLaunchScope, type LaunchScope } from '../launch-scope';

export function isSsoSignInOffered(scope: LaunchScope = readLaunchScope()): boolean {
  return scope !== 'pilot';
}
