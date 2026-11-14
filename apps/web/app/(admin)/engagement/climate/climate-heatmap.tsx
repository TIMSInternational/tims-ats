'use client';

import { useI18n } from '../../../../lib/i18n';
import { useEngagementClimateHeatmap } from '../../../../lib/platform-api/engagement';
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '../../../../components';

/** Absolute thresholds on the 0-100 scale, so the best dimension is not green at 40/100. */
function tone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

export function ClimateHeatmap() {
  const { t } = useI18n();
  const q = useEngagementClimateHeatmap();
  // round 7: category scores are min-5 suppressed (null) uniformly when any category
  // has a sub-floor distinct-respondent set, or the whole survey is < 5 respondents
  // (data empty). Drop null-score cells so a suppressed heatmap shows the empty state.
  const data = (q.data?.data ?? []).filter((d): d is { category: string; score: number } => d.score !== null);

  return (
    <section
      aria-labelledby="climate-dimensions"
      className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="climate-dimensions" className="text-heading font-semibold text-brand">
          {t.climate.dimensionScores}
        </h2>
        <span className="text-callout text-secondary">{t.climate.scaleNote}</span>
      </div>
      {q.isLoading ? (
        <div aria-busy="true" className="space-y-3">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState size="compact" title={t.climate.errClimate} error={q.error} onRetry={() => q.refetch()} />
      ) : data.length === 0 ? (
        <EmptyState size="compact" title={t.climate.noClimateData} />
      ) : (
        <ul className="space-y-2.5">
          {data.map((d) => (
            <li key={d.category} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-callout capitalize text-secondary sm:w-32">
                {d.category}
              </span>
              <ProgressBar
                value={d.score}
                label={d.category}
                hideLabel
                kind="meter"
                tone={tone(d.score)}
                className="flex-1"
              />
              <span className="w-8 shrink-0 text-right text-callout font-semibold tabular-nums text-primary">
                {d.score}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
