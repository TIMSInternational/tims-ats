'use client';

import { useState } from 'react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';
import { ErrorState } from '../../components';

export function ImpersonationBanner() {
  const { t } = useI18n();
  const { data, isError, refetch } = trpc.auth.getImpersonationStatus.useQuery(undefined, {
    staleTime: 60_000,
  });
  const [exiting, setExiting] = useState(false);

  if (isError) {
    return (
      <div className="bg-white border-b border-[#EDEDED]">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data?.isImpersonating) return null;

  const handleExit = async () => {
    setExiting(true);
    try {
      await fetch('/api/impersonate/stop', { method: 'POST' });
    } finally {
      // Hard navigation so the server layout + tRPC context re-resolve as the owner.
      window.location.href = '/platform/users';
    }
  };

  return (
    <div className="flex items-center justify-center gap-3 bg-[#DD0C15] px-4 py-1.5 text-white text-[12px]">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
      <span className="truncate">
        {t.impersonation.banner} <strong>{data.targetEmail}</strong>
      </span>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="ml-2 shrink-0 rounded bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30 disabled:opacity-60"
      >
        {exiting ? t.impersonation.exiting : t.impersonation.exit}
      </button>
    </div>
  );
}
