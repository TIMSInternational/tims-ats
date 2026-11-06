'use client';

import { useI18n } from '../../../../lib/i18n';

/** One check-in milestone in the onboarding table: done, overdue (scheduled day passed) or pending. */
export function CheckInBadge({ label, done, overdue }: { label: string; done: boolean; overdue: boolean }) {
  const { t } = useI18n();
  if (done) {
    return <span className="text-[9px] bg-green-50 text-green-600 px-1 py-0.5 rounded">{`${label} ✓`}</span>;
  }
  if (overdue) {
    return (
      <span className="text-[9px] bg-[#DD0C15]/10 text-[#DD0C15] px-1 py-0.5 rounded">
        {`${label} ${t.onboarding.checkInOverdueSuffix}`}
      </span>
    );
  }
  return (
    <span className="text-[9px] bg-amber-50 text-amber-700 px-1 py-0.5 rounded">
      {`${label} ${t.onboarding.checkInPendingSuffix}`}
    </span>
  );
}
