'use client';

import { useI18n, formatMessage } from '../../../../lib/i18n';
import { formatCurrency, formatPercent } from '../../../../lib/format-utils';
import { useDeiGenderRepresentation, useDeiPayEquity } from '../../../../lib/platform-api/dei';
import { EmptyState, ErrorState } from '../../../../components';
import { DEI_CARD, DEI_CARD_TITLE, GENDER_BAR, GENDER_FALLBACK_BAR, genderLabel } from './dei-shared';
import { DeiNoValue } from './dei-no-value';
import { DeiCardSkeleton } from './dei-card-skeleton';

export function GenderByDepartment() {
  const { t, locale } = useI18n();
  const q = useDeiGenderRepresentation();
  // round 7: distribution is now { groups, suppressed }. When suppressed (any group
  // 1..4) groups is empty + suppressed:true → render the no-demographics empty state.
  const groups = q.data?.groups ?? [];

  return (
    <section aria-labelledby="dei-gender" className={DEI_CARD}>
      <h2 id="dei-gender" className={DEI_CARD_TITLE}>
        {t.dei.genderRepresentation}
      </h2>
      {q.isLoading ? (
        <DeiCardSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.dei.errGenderRep} error={q.error} onRetry={() => q.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState size="compact" title={t.dei.noDemographics} />
      ) : (
        <>
          {/* Shape only; the values are in the legend below (white 2px gaps between segments). */}
          <div className="mb-3 flex h-6 gap-0.5 overflow-hidden rounded-full bg-white" aria-hidden="true">
            {groups.map((g) => (
              <div
                key={g.gender}
                className={GENDER_BAR[g.gender] ?? GENDER_FALLBACK_BAR}
                style={{ width: `${g.percentage ?? 0}%` }}
              />
            ))}
          </div>
          <ul className="space-y-1.5">
            {groups.map((g) => (
              <li key={g.gender} className="flex items-center justify-between gap-2 text-callout">
                <span className="flex items-center gap-1.5 text-primary">
                  <span
                    className={`size-2.5 rounded-sm ${GENDER_BAR[g.gender] ?? GENDER_FALLBACK_BAR}`}
                    aria-hidden="true"
                  />
                  {genderLabel(t, g.gender)}
                </span>
                {/* min-5 mask: a group is masked when its own count is sub-floor OR
                    when a sibling group is suppressed (all counts/percentages nulled
                    to block denominator-differencing). Key off the nulled value. */}
                <span className="tabular-nums text-secondary">
                  {g.count === null || g.percentage === null ? (
                    <DeiNoValue />
                  ) : (
                    `${g.count} · ${formatPercent(g.percentage, locale)}`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function PayEquityTable() {
  const { t, locale } = useI18n();
  const q = useDeiPayEquity();
  const gap = q.data?.gapPct;
  const currency = q.data?.currency ?? 'USD';
  const money = (n: number) => formatCurrency(n, currency, 0);
  const gapClass =
    gap == null ? '' : Math.abs(gap) < 3 ? 'text-success' : Math.abs(gap) <= 5 ? 'text-warning' : 'text-danger';

  return (
    <section aria-labelledby="dei-pay" className={DEI_CARD}>
      <h2 id="dei-pay" className={DEI_CARD_TITLE}>
        {t.dei.payEquityByGender}
      </h2>
      {q.isLoading ? (
        <DeiCardSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.dei.errPayEquity} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.results.length === 0 ? (
        <EmptyState size="compact" title={t.dei.noComp} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <caption className="mb-2 text-left text-callout text-secondary">
                {formatMessage(t.dei.salaryIn, { currency })}
              </caption>
              <thead>
                <tr className="border-b border-border text-callout text-secondary">
                  <th scope="col" className="py-2 text-left font-semibold">
                    {t.dei.colGender}
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    {t.dei.colEmployees}
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    {t.dei.colAverage}
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    {t.dei.colMedian}
                  </th>
                </tr>
              </thead>
              <tbody className="text-primary">
                {q.data.results.map((row) => (
                  <tr key={row.group} className="border-b border-border-subtle last:border-b-0">
                    <td className="py-2 font-medium">{genderLabel(t, row.group)}</td>
                    {/* min-5 mask: count + salary stats are nulled either when this group
                        is sub-floor OR when any sibling group is (all-or-nothing
                        differencing guard). Key off the nulled value directly. */}
                    <td className="py-2 text-right tabular-nums">{row.count === null ? <DeiNoValue /> : row.count}</td>
                    <td className="py-2 text-right tabular-nums">
                      {row.averageSalary === null ? <DeiNoValue /> : money(row.averageSalary)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {row.medianSalary === null ? <DeiNoValue /> : money(row.medianSalary)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {gap !== null && gap !== undefined && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-callout text-secondary">{t.dei.medianGap}</span>
              <span className={`text-body font-semibold tabular-nums ${gapClass}`}>
                {gap > 0 ? '+' : ''}
                {formatPercent(gap, locale, 1)}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
