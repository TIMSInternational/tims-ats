'use client';

import { SsoProviderButtons } from '../(auth)/login/sso-provider-buttons';
import { OrDivider } from '../(auth)/or-divider';

/**
 * Google / Microsoft for an invitee whose account already exists, laid out like /login: the provider
 * buttons, then the "o con tu correo" divider above the password field. The pilot hides SSO (staff sign in
 * with a password at /login, which offers no SSO either), so an account completed here can always sign in
 * again; this then renders nothing.
 */
export function InvitationExistingControls({
  busy,
  ssoEnabled,
  continueGoogle,
  continueMicrosoft,
  orWithEmail,
  onSocial,
}: {
  busy: boolean;
  ssoEnabled: boolean;
  continueGoogle: string;
  continueMicrosoft: string;
  orWithEmail: string;
  onSocial: (provider: 'google' | 'azure') => void;
}) {
  if (!ssoEnabled) return null;
  return (
    <>
      <SsoProviderButtons
        labels={{ google: continueGoogle, azure: continueMicrosoft }}
        disabled={busy}
        onSelect={onSocial}
        className="grid grid-cols-1 gap-3"
      />
      <OrDivider label={orWithEmail} />
    </>
  );
}
