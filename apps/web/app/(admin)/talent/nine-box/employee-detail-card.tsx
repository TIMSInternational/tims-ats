'use client';

import { CandidateAvatar, ErrorState, ProgressBar, Skeleton, StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatPercent } from '../../../../lib/format-utils';
import { isQuadrantKey, QUADRANT_TONE } from './nine-box-labels';

/** The latest period in the history reads as current. */
const CURRENT_RING = 'ring-1 ring-current';

interface DetailEvaluation {
  quadrant: string;
  potentialScore: number;
  performanceScore: number;
  confidence: number;
  user: { firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}

interface EmployeeDetailCardProps {
  detail: DetailEvaluation | null | undefined;
  history: Array<{ period: string; quadrant: string }>;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** The selected person: quadrant, both scores, confidence and movement history. */
export function EmployeeDetailCard({ detail, history, isLoading, error, onRetry }: EmployeeDetailCardProps) {
  const { t, locale } = useI18n();
  const quadrantName = (q: string) => (isQuadrantKey(q) ? t.nineBox.quadrants[q] : q);
  const quadrantTone = (q: string) => (isQuadrantKey(q) ? QUADRANT_TONE[q] : 'neutral');

  const score = (label: string, value: number) => {
    const outOf100 = Math.round(value * 20);
    return (
      <div className="rounded-lg bg-surface p-3">
        <p className="mb-0.5 text-callout text-secondary">{label}</p>
        <p className="text-title font-semibold tabular-nums text-brand">
          {outOf100}
          <span className="text-callout font-normal text-secondary">{t.nineBox.outOf100}</span>
        </p>
        <ProgressBar value={outOf100} label={label} hideLabel kind="meter" className="mt-1" />
      </div>
    );
  };

  return (
    <section aria-labelledby="nine-box-detail" className="rounded-xl border border-border bg-white p-4 shadow-card">
      <h2 id="nine-box-detail" className="mb-3 text-heading font-semibold text-brand">
        {t.nineBox.selectedEmployeeDetail}
      </h2>
      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <ErrorState size="compact" error={error} onRetry={onRetry} />
      ) : detail ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <CandidateAvatar
              firstName={detail.user.firstName}
              lastName={detail.user.lastName}
              avatar={detail.user.avatar}
              size="md"
              decorative
            />
            <div className="min-w-0">
              <p className="text-body font-semibold text-primary">
                {detail.user.firstName} {detail.user.lastName}
              </p>
              {detail.user.jobTitle && <p className="text-callout text-secondary">{detail.user.jobTitle}</p>}
            </div>
            <StatusBadge tone={quadrantTone(detail.quadrant)} className="ml-auto">
              {quadrantName(detail.quadrant)}
            </StatusBadge>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            {score(t.nineBox.potential, detail.potentialScore)}
            {score(t.nineBox.performance, detail.performanceScore)}
          </div>
          <div className="mb-3 rounded-lg bg-surface p-3">
            <ProgressBar
              value={Math.round(detail.confidence * 100)}
              label={t.nineBox.confidenceLevel}
              valueText={formatPercent(Math.round(detail.confidence * 100), locale)}
              kind="meter"
            />
          </div>
          {history.length > 1 && (
            <div>
              <h3 className="mb-1.5 text-callout font-semibold text-brand">{t.nineBox.movementHistory}</h3>
              <ol className="flex flex-wrap items-center gap-2">
                {history.map((h, i) => (
                  <li key={h.period} className="flex items-center gap-2">
                    {i > 0 && (
                      <svg
                        className="size-4 text-muted"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    )}
                    <span className="flex flex-col items-start gap-0.5">
                      <StatusBadge
                        tone={quadrantTone(h.quadrant)}
                        className={i === history.length - 1 ? CURRENT_RING : undefined}
                      >
                        {quadrantName(h.quadrant)}
                      </StatusBadge>
                      <span className="text-caption text-secondary">{h.period}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      ) : (
        <p className="text-callout text-secondary">{t.nineBox.selectEmployeeFromGrid}</p>
      )}
    </section>
  );
}
