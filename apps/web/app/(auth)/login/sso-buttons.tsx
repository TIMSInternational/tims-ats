'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../../lib/i18n';
import { rememberPostLoginDestination } from '../../../lib/auth/post-login-destination';
import { authErrorMessage } from '../auth-error-message';
import { OrDivider } from '../or-divider';
import { SsoProviderButtons, type SsoProvider } from './sso-provider-buttons';

// "Continuar con Google / Microsoft" + the "o con tu correo" divider. Rendered only when
// isSsoSignInOffered() (hidden in the pilot launch scope). While the provider redirect starts both
// buttons are disabled, so a double click cannot fire two OAuth starts; a failure re-enables them.
export function SsoButtons({ redirect, onError }: { redirect: string; onError: (message: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<SsoProvider | null>(null);

  const start = async (provider: SsoProvider) => {
    if (busy) return;
    setBusy(provider);
    onError('');
    rememberPostLoginDestination(redirect);
    try {
      const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
        provider,
        options: {
          ...(provider === 'azure' ? { scopes: 'openid profile email' } : {}),
          redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        },
      });
      if (error) {
        onError(authErrorMessage(error, t.auth, t.auth.loginFailed));
        setBusy(null);
      }
    } catch (error) {
      onError(authErrorMessage(error, t.auth, t.auth.loginFailed));
      setBusy(null);
    }
  };

  return (
    <>
      <SsoProviderButtons
        labels={{ google: t.auth.continueGoogle, azure: t.auth.continueMicrosoft }}
        busy={busy}
        busyLabel={t.auth.ssoRedirecting}
        onSelect={(provider) => void start(provider)}
      />
      <OrDivider label={t.auth.orWithEmail} />
    </>
  );
}
