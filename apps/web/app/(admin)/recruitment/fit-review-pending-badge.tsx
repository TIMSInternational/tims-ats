'use client';

import { useI18n } from '../../../lib/i18n';
import { formatMessage } from '../../../lib/i18n/format';
import { STATUS_TONE_CLASSES, StatusBadge } from '../../../components';

function InfoIcon() {
  return (
    <svg
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" strokeLinecap="round" />
    </svg>
  );
}

/**
 * FIT v2: marks a FIT score that is provisional (a result it counts on awaits review), wherever the number is shown,
 * so it is not read as final. `unknown` marks a score whose review state could not be read (the C# read failed), so
 * it is not shown as final either. `compact` shows the short label; the full sentence stays readable by assistive
 * tech (a tooltip alone never reaches touch, keyboard or most screen readers: accessibility.md › Vision).
 */
export function FitReviewPendingBadge({ compact = false, unknown = false }: { compact?: boolean; unknown?: boolean }) {
  const { t } = useI18n();
  const full = unknown ? t.candidates.fitReviewUnknown : t.candidates.fitReviewPending;
  const short = unknown ? t.candidates.fitReviewUnknownShort : t.candidates.fitReviewPendingShort;
  const tone = unknown ? 'neutral' : 'warning';
  const testId = unknown ? 'fit-review-unknown' : 'fit-review-pending';
  if (!compact) {
    // The full sentence wraps, so it is a rounded label rather than a one-line chip.
    return (
      <span
        data-testid={testId}
        className={`inline-flex items-start gap-1 rounded-lg px-2 py-0.5 text-caption font-semibold ${STATUS_TONE_CLASSES[tone]}`}
      >
        <span className="mt-0.5">
          <InfoIcon />
        </span>
        {full}
      </span>
    );
  }
  return (
    <span data-testid={testId} className="inline-flex">
      <StatusBadge tone={tone} icon={<InfoIcon />}>
        <span aria-hidden="true" title={full}>
          {short}
        </span>
        <span className="sr-only">{formatMessage(t.candidates.fitReviewCompactSr, { short, full })}</span>
      </StatusBadge>
    </span>
  );
}
