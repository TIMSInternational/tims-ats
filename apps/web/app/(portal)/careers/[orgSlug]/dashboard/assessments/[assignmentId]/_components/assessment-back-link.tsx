'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../../../../lib/i18n';

export function AssessmentBackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/careers/${orgSlug}/dashboard`}
      className="text-[13px] text-[#8B8B8B] hover:text-[#585858] hover:underline"
    >
      {t.assessmentPlayer.backToDashboard}
    </Link>
  );
}
