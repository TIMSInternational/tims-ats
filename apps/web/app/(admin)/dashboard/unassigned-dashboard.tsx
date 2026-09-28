'use client';

import { useI18n } from '../../../lib/i18n';

/** A linked staff identity with no assigned staff role has no usable modules yet. */
export function UnassignedDashboard({ email }: { email?: string }) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-full items-center justify-center px-5 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--content-border-default)] bg-white px-7 py-9 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F3F0FA] text-[#1F114C]" aria-hidden="true">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20v-1.5A6.5 6.5 0 0111.5 12h1A6.5 6.5 0 0119 18.5V20" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-[#1F114C]">{t.unassignedDashboard.title}</h1>
        <p className="mt-3 text-sm leading-6 text-[#585858]">{t.unassignedDashboard.description}</p>
        {email && (
          <p className="mt-4 break-all rounded-lg bg-[#F6F6F6] px-3 py-2 text-xs text-[#585858]">
            {t.unassignedDashboard.signedInAs} <strong>{email}</strong>
          </p>
        )}
        <p className="mt-4 text-sm text-[#585858]">{t.unassignedDashboard.nextStep}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1F114C] px-5 text-sm font-medium text-white transition-colors hover:bg-[#2A1866] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F114C]"
        >
          {t.unassignedDashboard.refresh}
        </button>
      </div>
    </div>
  );
}
