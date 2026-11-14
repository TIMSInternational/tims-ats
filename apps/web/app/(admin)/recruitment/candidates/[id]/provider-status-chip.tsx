'use client';

import { StatusBadge, type StatusTone } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import type { StaffStatus } from '../../../../../lib/platform-api/assessment-providers-staff';

const TONE: Record<StaffStatus, StatusTone> = {
  pending: 'neutral',
  consent_needed: 'warning',
  sent: 'info',
  in_progress: 'info',
  scoring: 'info',
  result_ready: 'success',
  needs_review: 'warning',
  expired: 'neutral',
  cancelled: 'neutral',
  withdrawn: 'danger',
  erased: 'neutral',
};

// One provider attempt's status, as a chip. The colour never carries meaning alone: the label always says it.
export function ProviderStatusChip({ status }: { status: StaffStatus }) {
  const { t } = useI18n();
  return (
    <span data-testid="provider-status-chip" data-status={status}>
      <StatusBadge tone={TONE[status] ?? 'neutral'}>{t.providerAssessments.status[status]}</StatusBadge>
    </span>
  );
}
