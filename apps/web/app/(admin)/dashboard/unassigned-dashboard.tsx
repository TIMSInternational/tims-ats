'use client';

import { useI18n } from '../../../lib/i18n';
import { Button } from '../../../components/button';

/** A linked staff identity with no assigned staff role has no usable modules yet. */
export function UnassignedDashboard({ email }: { email?: string }) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-full items-center justify-center px-5 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-white px-7 py-9 text-center shadow-card">
        <div
          className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand-tint text-brand"
          aria-hidden="true"
        >
          <svg className="size-7" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20v-1.5A6.5 6.5 0 0111.5 12h1A6.5 6.5 0 0119 18.5V20" />
          </svg>
        </div>
        <h1 className="font-display text-title font-semibold text-brand">{t.unassignedDashboard.title}</h1>
        <p className="mt-3 text-body text-secondary">{t.unassignedDashboard.description}</p>
        {email && (
          <p className="mt-4 break-all rounded-lg bg-surface px-3 py-2 text-callout text-secondary">
            {t.unassignedDashboard.signedInAs} <strong>{email}</strong>
          </p>
        )}
        <p className="mt-4 text-body text-secondary">{t.unassignedDashboard.nextStep}</p>
        <Button size="lg" className="mt-6" onClick={() => window.location.reload()}>
          {t.unassignedDashboard.refresh}
        </Button>
      </div>
    </div>
  );
}
