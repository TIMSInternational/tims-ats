'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatPercent } from '../../../../lib/format-utils';
import { useEngagementEnps } from '../../../../lib/platform-api/engagement';
import { EmptyState, Skeleton } from '../../../../components';

export function ClimateResults() {
  const { t, locale } = useI18n();
  const q = useEngagementEnps();

  // eNPS is suppressed (min-5 k-anonymity) when the backend nulls its head-counts.
  const suppressed = q.data?.suppressed === true || (q.data != null && q.data.promoters == null);
  const segments =
    q.data && !suppressed
      ? [
          { label: t.climate.promoters, value: q.data.promoters ?? 0, cls: 'bg-success' },
          { label: t.climate.passives, value: q.data.passives ?? 0, cls: 'bg-warning' },
          { label: t.climate.detractors, value: q.data.detractors ?? 0, cls: 'bg-danger' },
        ]
      : [];
  const total = q.data?.totalResponses ?? 0;
  const pct = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

  return (
    <section aria-labelledby="climate-enps" className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5">
      <h2 id="climate-enps" className="mb-3 text-heading font-semibold text-brand">
        {t.climate.enpsDistribution}
      </h2>
      {/* The page shows one error for the eNPS read, so this card only handles loading and empty. */}
      {q.isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-6 w-full rounded-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : suppressed ? (
        <EmptyState size="compact" title={t.climate.enpsSuppressed} />
      ) : total === 0 ? (
        <EmptyState size="compact" title={t.climate.noClimateData} />
      ) : (
        <>
          <div className="mb-3 flex h-6 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {segments.map((s) => (
              <div key={s.label} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} />
            ))}
          </div>
          <ul className="space-y-1.5">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-2 text-callout">
                <span className="flex items-center gap-1.5 text-primary">
                  <span className={`size-2.5 rounded-sm ${s.cls}`} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="tabular-nums text-secondary">
                  {s.value} · {formatPercent(pct(s.value), locale)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
