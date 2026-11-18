'use client';

import { StatusBadge } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import type { StaffStatus } from '../../../../../lib/platform-api/assessment-providers-staff';

const TONE: Record<StaffStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  consent_needed: 'bg-amber-50 text-amber-700',
  sent: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-blue-50 text-blue-700',
  scoring: 'bg-indigo-50 text-indigo-700',
  result_ready: 'bg-green-50 text-green-700',
  needs_review: 'bg-amber-100 text-amber-800',
  expired: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-600',
  withdrawn: 'bg-red-50 text-red-700',
  erased: 'bg-gray-100 text-gray-600',
};

// One provider attempt's status, as a chip. The colour never carries meaning alone: the label always says it.
export function ProviderStatusChip({ status }: { status: StaffStatus }) {
  const { t } = useI18n();
  const labels = t.providerAssessments.status;
  const map = Object.fromEntries(
    (Object.keys(TONE) as StaffStatus[]).map((key) => [key, { cls: TONE[key], label: labels[key] }]),
  );
  return (
    <span data-testid="provider-status-chip" data-status={status}>
      <StatusBadge status={status} map={map} />
    </span>
  );
}
