'use client';

import { useI18n, formatMessage } from '../../../../lib/i18n';
import { formatNumber, formatPercent } from '../../../../lib/format-utils';
import { useDeiPromotionEquity, useDeiLeadershipDiversity } from '../../../../lib/platform-api/dei';
import { EmptyState, ErrorState } from '../../../../components';
import { DEI_CARD, DEI_CARD_TITLE, GENDER_BAR, GENDER_FALLBACK_BAR, genderLabel } from './dei-shared';
import { DeiNoValue } from './dei-no-value';
import { DeiCardSkeleton } from './dei-card-skeleton';

export function PromotionEquity() {
  const { t, locale } = useI18n();
  const q = useDeiPromotionEquity();

  return (
    <section aria-labelledby="dei-promotions" className={DEI_CARD}>
      <h2 id="dei-promotions" className={DEI_CARD_TITLE}>
        {t.dei.promotions}
      </h2>
      {q.isLoading ? (
        <DeiCardSkeleton rows={2} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.dei.errPromotions} error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="text-display font-semibold tabular-nums text-primary">
            {q.data?.totalPromotions == null ? <DeiNoValue /> : formatNumber(q.data.totalPromotions, locale)}
          </p>
          <p className="mt-1 text-callout text-secondary">
            {q.data?.year != null && `${formatMessage(t.dei.promotionsYear, { year: q.data.year })} `}
            {t.dei.promotionsBreakdownNote}
          </p>
        </>
      )}
    </section>
  );
}

export function LeadershipDiversity() {
  const { t, locale } = useI18n();
  const q = useDeiLeadershipDiversity();

  return (
    <section aria-labelledby="dei-leadership" className={DEI_CARD}>
      <h2 id="dei-leadership" className={DEI_CARD_TITLE}>
        {t.dei.leadershipDiversity}
      </h2>
      {q.isLoading ? (
        <DeiCardSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.dei.errLeadership} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.byGender.length === 0 ? (
        <EmptyState size="compact" title={t.dei.noLeaders} />
      ) : (
        <>
          <div className="mb-3 flex h-6 gap-0.5 overflow-hidden rounded-full bg-white" aria-hidden="true">
            {q.data.byGender.map((g) => (
              <div
                key={g.gender}
                className={GENDER_BAR[g.gender] ?? GENDER_FALLBACK_BAR}
                style={{ width: `${g.percentage ?? 0}%` }}
              />
            ))}
          </div>
          <ul className="space-y-1.5">
            {q.data.byGender.map((g) => (
              <li key={g.gender} className="flex items-center justify-between gap-2 text-callout">
                <span className="flex items-center gap-1.5 text-primary">
                  <span
                    className={`size-2.5 rounded-sm ${GENDER_BAR[g.gender] ?? GENDER_FALLBACK_BAR}`}
                    aria-hidden="true"
                  />
                  {genderLabel(t, g.gender)}
                </span>
                {/* min-5 mask: percentage is nulled when this leader group is sub-floor
                    OR when any sibling is (all-or-nothing differencing guard). */}
                <span className="font-semibold tabular-nums text-primary">
                  {g.percentage === null ? <DeiNoValue /> : formatPercent(g.percentage, locale)}
                </span>
              </li>
            ))}
          </ul>
          {/* No invented goal line: a target shows here only once one is configured. */}
          <p className="mt-2 border-t border-border pt-2 text-callout text-secondary">
            {q.data.totalLeaders == null ? (
              <DeiNoValue />
            ) : (
              formatMessage(t.dei.leadersCount, { count: q.data.totalLeaders })
            )}
          </p>
        </>
      )}
    </section>
  );
}
