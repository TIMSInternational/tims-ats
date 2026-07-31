'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../../../../lib/i18n';

export function AssessmentBackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/careers/${orgSlug}/dashboard`}
      className="fixed top-4 left-4 z-40 rounded-lg bg-white/90 px-3 py-1.5 text-[13px] text-[#8B8B8B] shadow-sm backdrop-blur-sm hover:text-[#585858] hover:underline"
    >
      {t.assessmentPlayer.backToDashboard}
    </Link>
  );
}
