'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Scoped route-segment error boundary UI, rendered by the per-group error.tsx
// files (admin / portal / assessment / auth). A thrown render error now shows a
// contained, retryable message INSIDE the shell instead of escaping to the root
// global-error boundary (which replaces the entire app). Strings are hardcoded
// (allowlisted in the i18n gate) because an error boundary must not depend on
// context — including I18nProvider — that may itself be what broke; if i18n is
// the failure this component still renders, and re-throws bubble to global-error.
export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#DD0C15]/10">
        <svg
          className="h-6 w-6 text-[#DD0C15]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <h2 className="mt-4 text-[18px] font-semibold text-[#1F114C]">Algo salió mal</h2>
      <p className="mt-1 max-w-sm text-[14px] text-[#585858]">
        Ocurrió un error inesperado. Intenta de nuevo.
      </p>
      <button
        onClick={() => reset()}
        className="mt-5 h-9 rounded-lg bg-[#1F114C] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#2a1a5e]"
      >
        Reintentar
      </button>
    </div>
  );
}
