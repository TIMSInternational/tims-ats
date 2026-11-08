'use client';

import { useI18n } from '../../../lib/i18n';

/**
 * FIT v2: marks a FIT score that is provisional (a result it counts on awaits review), wherever the number is shown,
 * so it is not read as final. `unknown` marks a score whose review state could not be read (the C# read failed), so
 * it is not shown as final either. `compact` shows the short label, with the full sentence as the tooltip.
 */
export function FitReviewPendingBadge({ compact = false, unknown = false }: { compact?: boolean; unknown?: boolean }) {
  const { t } = useI18n();
  const full = unknown ? t.candidates.fitReviewUnknown : t.candidates.fitReviewPending;
  const short = unknown ? t.candidates.fitReviewUnknownShort : t.candidates.fitReviewPendingShort;
  return (
    <span
      title={full}
      data-testid={unknown ? 'fit-review-unknown' : 'fit-review-pending'}
      className={`inline-flex items-center text-[10px] font-medium rounded px-1.5 py-0.5 border ${
        unknown ? 'text-gray-600 bg-gray-50 border-gray-200' : 'text-amber-700 bg-amber-50 border-amber-200'
      }`}
    >
      {compact ? short : full}
    </span>
  );
}
