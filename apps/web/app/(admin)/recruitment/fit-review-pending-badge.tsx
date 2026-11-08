'use client';

import { useI18n } from '../../../lib/i18n';

/**
 * FIT v2: marks a FIT score that is provisional (a result it counts on awaits review), wherever the number is shown,
 * so it is not read as final. `compact` shows the short label, with the full sentence as the tooltip.
 */
export function FitReviewPendingBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      title={t.candidates.fitReviewPending}
      data-testid="fit-review-pending"
      className="inline-flex items-center text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
    >
      {compact ? t.candidates.fitReviewPendingShort : t.candidates.fitReviewPending}
    </span>
  );
}
