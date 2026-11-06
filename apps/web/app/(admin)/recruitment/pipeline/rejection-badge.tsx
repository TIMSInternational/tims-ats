'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { rejectionReasonLabel } from '../../../../lib/reject-reasons';

interface RejectionBadgeProps {
  rejectedAt?: Date | string | null;
  rejectedReason?: string | null;
  /** Also print the reason under the badge (list and table rows; a tooltip alone is invisible on a phone). */
  showReason?: boolean;
}

/** "Rechazado el {fecha}" with the localized reason, for the Rechazados / Todos board views (A-05). */
export function RejectionBadge({ rejectedAt, rejectedReason, showReason = false }: RejectionBadgeProps) {
  const { t } = useI18n();
  const reason = rejectionReasonLabel(rejectedReason, t.rejectCandidateModal.reasons);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span title={reason || undefined} className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium">
        {rejectedAt ? t.pipeline.rejectedOn.replace('{date}', formatDate(rejectedAt)) : t.pipeline.applicationStatus.rejected}
      </span>
      {showReason && reason && (
        <span className="text-[10px] text-[#8B8B8B]">{t.candidates.rejectionReason.replace('{reason}', reason)}</span>
      )}
    </span>
  );
}
