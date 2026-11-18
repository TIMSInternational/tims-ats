'use client';

import { useId } from 'react';
import { useMonitoringCrossModuleTrend } from '../../../lib/platform-api/monitoring';
import { useI18n } from '../../../lib/i18n';
import { formatMessage } from '../../../lib/i18n/format';
import { intlLocale } from '../../../lib/format-utils';
import { ErrorState } from '../../../components';
import { ChartFigure } from '../dashboard/charts/chart-figure';

/** "2026-06" → "jun" / "Jun" in the UI locale (the axis used to read "06…11"). */
function monthName(month: string, locale: 'ES' | 'EN', style: 'short' | 'long'): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: style }).format(new Date(y, m - 1, 1));
}

export function CrossModuleTrend() {
  const { t, locale } = useI18n();
  const q = useMonitoringCrossModuleTrend({ metric: 'headcount', period: '6m' });
  const titleId = useId();
  const data = q.data?.data ?? [];
  // value is null for k-anonymity-suppressed points (sub-floor engagement months);
  // treat null as 0 for the bar height and show a mask glyph instead of the count.
  const max = data.reduce((m, d) => Math.max(m, d.value ?? 0), 0) || 1;
  const shown = (v: number | null) => (v === null ? '—' : String(v));

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col rounded-xl bg-white p-4 shadow-card">
      <h2 id={titleId} className="mb-2 text-subheading font-semibold text-brand">
        {t.monitoring.headcountTrend}
      </h2>
      {q.isLoading ? (
        <div className="h-36 animate-pulse rounded bg-surface motion-reduce:animate-none" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
        </div>
      ) : q.isError ? (
        <ErrorState size="compact" title={t.monitoring.trendErr} onRetry={() => q.refetch()} error={q.error} />
      ) : data.length === 0 ? (
        <p className="text-callout text-secondary">{t.monitoring.trendEmpty}</p>
      ) : (
        <ChartFigure
          summary={formatMessage(t.monitoring.trendSummary, {
            from: shown(data[0].value),
            to: shown(data[data.length - 1].value),
            months: data.length,
          })}
          columns={[t.monitoring.trendMonth, t.monitoring.trendPeople]}
          rows={data.map((d) => ({ label: monthName(d.month, locale, 'long'), value: shown(d.value) }))}
        >
          <div className="flex h-36 items-end justify-between gap-2 pt-2">
            {data.map((d) => (
              <div key={d.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-caption font-medium tabular-nums text-secondary">{shown(d.value)}</span>
                <div
                  className="w-full rounded-t bg-brand"
                  style={{ height: `${Math.max(((d.value ?? 0) / max) * 100, 4)}%` }}
                />
                <span className="text-caption text-muted">{monthName(d.month, locale, 'short')}</span>
              </div>
            ))}
          </div>
        </ChartFigure>
      )}
    </section>
  );
}
