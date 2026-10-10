'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';

// Shown instead of the dashboard when the session's email is not confirmed: the portal identifies a candidate by
// email, so an unverified address must never open anyone's application history or privacy actions
// (docs/architecture/candidate-portal-email-verification.md).
export function DashboardVerifyEmail({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  const m = t.portalDashboard;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F6F6] px-4 py-10">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
        <h1 className="mb-2 text-[18px] font-bold text-[#1F114C]">{m.verifyEmailTitle}</h1>
        <p className="mb-5 text-[13px] text-[#585858]">{m.verifyEmailDesc}</p>
        <Link
          href={`/careers/${orgSlug}/login`}
          className="inline-flex h-10 items-center rounded-xl bg-[#1F114C] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2a1a5e]"
        >
          {m.verifyEmailAction}
        </Link>
      </div>
    </div>
  );
}
