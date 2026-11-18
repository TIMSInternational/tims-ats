'use client';

import { STATUS_TONE_CLASSES } from '../../../../components';
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
      {/* The danger tone of the foundation StatusBadge, kept as one span so the tooltip sits on the chip. */}
      <span
        title={reason || undefined}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold ${STATUS_TONE_CLASSES.danger}`}
      >
        <svg
          className="size-3 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
        {rejectedAt
          ? t.pipeline.rejectedOn.replace('{date}', formatDate(rejectedAt))
          : t.pipeline.applicationStatus.rejected}
      </span>
      {showReason && reason && (
        <span className="text-caption text-secondary">{t.candidates.rejectionReason.replace('{reason}', reason)}</span>
      )}
    </span>
  );
}
