'use client';

import { EmptyState, ErrorState, ProgressBar, Skeleton } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatPercent } from '../../../../lib/format-utils';

interface CoverageItem {
  roleId: string;
  title: string;
  totalSuccessors: number;
  readyNow: number;
  readySoon: number;
  coverageStatus: string;
}

interface CompetencyCoverageProps {
  data: CoverageItem[] | undefined;
  loading: boolean;
  isError: boolean;
  t: {
    competencyCoverage: string;
    average: string;
    competencyCoverageEmpty: string;
    competencyCoverageEmptyDesc: string;
    loadError: string;
  };
}

/** Absolute thresholds on the 0-100 scale: ≥70 covered, ≥50 partial, else low. */
function tone(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 70) return 'success';
  if (pct >= 50) return 'warning';
  return 'danger';
}

const VALUE_TONE = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;

export function CompetencyCoverage({ data, loading, isError, t: ts }: CompetencyCoverageProps) {
  const { t, locale } = useI18n();
  const items = (data ?? []).map((d) => {
    const total = d.readyNow + d.readySoon;
    const pct = d.totalSuccessors > 0 ? Math.round((total / d.totalSuccessors) * 100) : 0;
    return { id: d.roleId, name: d.title, pct };
  });
  const avg = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.pct, 0) / items.length) : 0;

  return (
    <section
      aria-labelledby="competency-coverage"
      className="flex-1 rounded-xl border border-border bg-white p-4 shadow-card"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="competency-coverage" className="text-heading font-semibold text-brand">
          {ts.competencyCoverage}
        </h2>
        {!loading && !isError && items.length > 0 && (
          <span className="text-callout tabular-nums text-secondary">
            {ts.average}: {formatPercent(avg, locale)}
          </span>
        )}
      </div>
      {loading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState size="compact" title={ts.loadError} />
      ) : items.length === 0 ? (
        <EmptyState size="compact" title={ts.competencyCoverageEmpty} description={ts.competencyCoverageEmptyDesc} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <div className="mb-1 flex justify-between gap-2 text-callout">
                <span className="text-secondary">{item.name}</span>
                <span className={`font-semibold tabular-nums ${VALUE_TONE[tone(item.pct)]}`}>
                  {formatPercent(item.pct, locale)}
                </span>
              </div>
              <ProgressBar value={item.pct} label={item.name} hideLabel kind="meter" tone={tone(item.pct)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
