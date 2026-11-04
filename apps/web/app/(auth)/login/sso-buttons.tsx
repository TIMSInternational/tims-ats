'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../../lib/i18n';
import { authErrorMessage } from '../auth-error-message';

type Provider = 'google' | 'azure';

const BUTTON_CLASS =
  'w-full flex items-center justify-center gap-3 h-11 rounded-xl border border-[#EDEDED] text-[13px] font-medium text-[#333] hover:bg-[#FAFAFA] disabled:opacity-50 disabled:cursor-not-allowed transition';

// "Continuar con Google / Microsoft" + the "o con email" divider. Rendered only when
// isSsoSignInOffered() (hidden in the pilot launch scope). While the provider redirect starts both
// buttons are disabled, so a double click cannot fire two OAuth starts; a failure re-enables them.
export function SsoButtons({ redirect, onError }: { redirect: string; onError: (message: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<Provider | null>(null);

  const start = async (provider: Provider) => {
    if (busy) return;
    setBusy(provider);
    onError('');
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
      <div className="space-y-3 mb-6">
        <button type="button" onClick={() => void start('google')} disabled={busy !== null} className={BUTTON_CLASS}>
          <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {busy === 'google' ? t.auth.ssoRedirecting : t.auth.continueGoogle}
        </button>
        <button type="button" onClick={() => void start('azure')} disabled={busy !== null} className={BUTTON_CLASS}>
          <svg className="w-5 h-5" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          {busy === 'azure' ? t.auth.ssoRedirecting : t.auth.continueMicrosoft}
        </button>
      </div>

      {/* Divider */}
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[#EDEDED]"></div>
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-[12px] text-[#8B8B8B]">{t.auth.orWithEmail}</span>
        </div>
      </div>
    </>
  );
}
