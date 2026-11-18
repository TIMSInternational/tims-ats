'use client';

import { useI18n } from '../../../../lib/i18n';
import { StatusBadge } from '../../../../components';

/** One check-in milestone in the onboarding table: done, overdue (scheduled day passed) or pending. */
export function CheckInBadge({ label, done, overdue }: { label: string; done: boolean; overdue: boolean }) {
  const { t } = useI18n();
  if (done) {
    return (
      <StatusBadge tone="success" icon="none">
        {`${label} ✓`}
      </StatusBadge>
    );
  }
  if (overdue) {
    return <StatusBadge tone="danger">{`${label} ${t.onboarding.checkInOverdueSuffix}`}</StatusBadge>;
  }
  return <StatusBadge tone="neutral">{`${label} ${t.onboarding.checkInPendingSuffix}`}</StatusBadge>;
}
