'use client';

import { Button } from '../../../../../components/button';
import { useI18n } from '../../../../../lib/i18n';

// Shown instead of the dashboard when the session's email is not confirmed: the portal identifies a candidate by
// email, so an unverified address must never open anyone's application history or privacy actions
// (docs/architecture/candidate-portal-email-verification.md).
export function DashboardVerifyEmail({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  const m = t.portalDashboard;
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 text-center shadow-card sm:p-8">
        <h1 className="mb-2 font-display text-title font-bold text-brand">{m.verifyEmailTitle}</h1>
        <p className="mb-5 text-base text-secondary sm:text-body">{m.verifyEmailDesc}</p>
        <Button href={`/careers/${orgSlug}/login`} size="lg">
          {m.verifyEmailAction}
        </Button>
      </div>
    </main>
  );
}
