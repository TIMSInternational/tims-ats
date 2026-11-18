'use client';

import { useI18n, formatMessage } from '../../../lib/i18n';
import { Skeleton } from '../../../components';
import { CompCard } from './comp-card';
import { CompCardError } from './comp-card-error';
import { formatCurrency } from '../../../lib/format-utils';
import { useDeiPayEquity } from '../../../lib/platform-api/dei';
import { useCompensationBandDistribution } from '../../../lib/platform-api/compensation';

const fmtCompactCurrency = (n: number, currency: string) => formatCurrency(Math.round(n / 1000) * 1000, currency);

function genderLabel(t: ReturnType<typeof useI18n>['t'], g: string): string {
  return g === 'male'
    ? t.dei.genderMale
    : g === 'female'
      ? t.dei.genderFemale
      : g === 'non_binary'
        ? t.dei.genderNonBinary
        : g === 'undisclosed'
          ? t.dei.genderUndisclosed
          : g;
}

export function SalaryBands() {
  const { t } = useI18n();
  const q = useCompensationBandDistribution();

  return (
    <CompCard
      title={t.compensation.bands}
      aside={<span className="text-callout text-secondary">{t.compensation.bandsUnit}</span>}
    >
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <CompCardError message={t.compensation.bandsErr} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-callout text-secondary">{t.compensation.bandsEmpty}</p>
      ) : (
        <>
          <ul className="space-y-3">
            {q.data.map((b) => {
              const currency = b.currency ?? 'USD';
              const min = fmtCompactCurrency(b.min, currency);
              const mid = fmtCompactCurrency(b.mid, currency);
              const max = fmtCompactCurrency(b.max, currency);
              const outliers = b.dots.filter((d) => d.outlier).length;
              return (
                <li key={b.level + b.title} className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[4.5rem_1fr_auto]">
                  {/* The bar is a picture; this sentence carries the same facts for screen readers. */}
                  <span className="sr-only">
                    {formatMessage(t.compensation.bandSummary, {
                      level: b.level,
                      n: b.dots.length,
                      m: outliers,
                      min,
                      mid,
                      max,
                    })}
                  </span>
                  <div className="truncate text-callout font-medium text-secondary" aria-hidden="true">
                    {b.level}
                  </div>
                  <div className="relative h-6" aria-hidden="true">
                    <div className="absolute inset-y-0 inset-x-0 rounded bg-brand/10" />
                    <div className="absolute inset-x-1/4 top-1 bottom-1 rounded bg-brand/30" />
                    {b.dots.map((d, i) => (
                      <div
                        key={i}
                        className={`absolute top-1/2 size-2.5 -translate-y-1/2 border-2 border-white shadow ${
                          d.outlier ? 'rotate-45 rounded-[1px] bg-danger' : 'rounded-full bg-brand'
                        }`}
                        style={{ left: `${d.pos}%` }}
                      />
                    ))}
                  </div>
                  <div
                    className="col-start-2 flex justify-between gap-2 text-caption tabular-nums text-secondary sm:col-start-auto sm:w-36 sm:justify-end"
                    aria-hidden="true"
                  >
                    <span>{min}</span>
                    <span>{mid}</span>
                    <span>{max}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3" aria-hidden="true">
            <div className="flex items-center gap-1.5 text-caption text-secondary">
              <div className="size-2 rounded-full bg-brand" /> {t.compensation.legendInBand}
            </div>
            <div className="flex items-center gap-1.5 text-caption text-secondary">
              <div className="size-2 rotate-45 bg-danger" /> {t.compensation.legendOutBand}
            </div>
            <div className="flex items-center gap-1.5 text-caption text-secondary">
              <div className="h-2 w-3 rounded bg-brand/10" /> {t.compensation.legendRange}
            </div>
          </div>
        </>
      )}
    </CompCard>
  );
}

function gapTone(gap: number): string {
  if (Math.abs(gap) < 3) return 'text-success';
  if (Math.abs(gap) <= 5) return 'text-warning';
  return 'text-danger';
}

export function PayEquityCard() {
  const { t } = useI18n();
  const q = useDeiPayEquity();
  const gap = q.data?.gapPct;

  return (
    <CompCard title={t.dei.payEquityByGender}>
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : q.isError ? (
        <CompCardError message={t.dei.errPayEquity} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.results.length === 0 ? (
        <p className="text-callout text-secondary">{t.dei.noComp}</p>
      ) : (
        <>
          <table className="w-full text-callout">
            <thead>
              <tr className="border-b border-border text-secondary">
                <th scope="col" className="pb-2 pr-3 text-left font-medium">{t.dei.colGender}</th>
                <th scope="col" className="px-2 pb-2 text-right font-medium">{t.dei.colEmployees}</th>
                <th scope="col" className="px-2 pb-2 text-right font-medium">{t.dei.colAverage}</th>
                <th scope="col" className="px-2 pb-2 text-right font-medium">{t.dei.colMedian}</th>
              </tr>
            </thead>
            <tbody className="text-primary tabular-nums">
              {q.data.results.map((row, i) => (
                <tr key={row.group} className={i < q.data!.results.length - 1 ? 'border-b border-border/60' : ''}>
                  <th scope="row" className="py-2 pr-3 text-left font-medium">{genderLabel(t, row.group)}</th>
                  {/* min-5 suppressed groups mask count + salary stats (a small group's average IS individual pay). */}
                  <td className="px-2 py-2 text-right">{row.suppressed ? t.dei.na : row.count}</td>
                  <td className="px-2 py-2 text-right">
                    {row.suppressed || row.averageSalary === null
                      ? t.dei.na
                      : formatCurrency(row.averageSalary, q.data?.currency ?? 'USD')}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {row.suppressed || row.medianSalary === null
                      ? t.dei.na
                      : formatCurrency(row.medianSalary, q.data?.currency ?? 'USD')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gap !== null && gap !== undefined && (
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
              <span className="text-callout text-secondary">{t.dei.medianGap}</span>
              <span className={`text-body font-semibold tabular-nums ${gapTone(gap)}`}>
                {gap > 0 ? '+' : ''}
                {gap}%
              </span>
            </div>
          )}
        </>
      )}
    </CompCard>
  );
}
