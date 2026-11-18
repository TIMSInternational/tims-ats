'use client';

import { useI18n, formatMessage } from '../../../../lib/i18n';
import { formatNumber, formatPercent, intlLocale } from '../../../../lib/format-utils';
import {
  useDeiAgeDistribution,
  useDeiNationalityDiversity,
  useDeiHiringFunnel,
} from '../../../../lib/platform-api/dei';
import { EmptyState, ErrorState } from '../../../../components';
import { DEI_CARD, DEI_CARD_TITLE, RAMP } from './dei-shared';
import { DeiNoValue } from './dei-no-value';
import { DeiCardSkeleton } from './dei-card-skeleton';

const AGE_ORDER = ['<25', '25-34', '35-44', '45-54', '55+'];

/** A country name in the UI language, from its ISO code ("CO" → "Colombia" / "Estados Unidos"). */
function useCountryName() {
  const { locale } = useI18n();
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([intlLocale(locale)], { type: 'region' });
  } catch {
    names = null;
  }
  return (code: string) => {
    try {
      return names?.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

export function AgeDistribution() {
  const { t, locale } = useI18n();
  const q = useDeiAgeDistribution();
  // round 7: distribution is now { groups, suppressed }; empty groups when suppressed.
  const groups = q.data?.groups ?? [];
  const total = groups.reduce((sum, a) => sum + (a.count ?? 0), 0);

  return (
    <section aria-labelledby="dei-age" className={DEI_CARD}>
      <h2 id="dei-age" className={DEI_CARD_TITLE}>
        {t.dei.ageDistribution}
      </h2>
      {q.isLoading ? (
        <DeiCardSkeleton rows={5} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.dei.errAge} error={q.error} onRetry={() => q.refetch()} />
      ) : total === 0 ? (
        <EmptyState size="compact" title={t.dei.ageEmpty} />
      ) : (
        <>
          <ul className="space-y-2">
            {groups.map((a) => {
              const idx = AGE_ORDER.indexOf(a.range);
              const fill = RAMP[RAMP.length - 1 - (idx < 0 ? 2 : idx)] ?? RAMP[2];
              return (
                <li key={a.range} className="flex items-center gap-2 text-callout">
                  <span className="w-12 shrink-0 tabular-nums text-secondary">{a.range}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                    {/* min-5 suppressed bands (1..4 people) render no bar and a masked label. */}
                    <div
                      className={`h-3 rounded-full ${fill}`}
                      style={{ width: `${Math.max(a.percentage ?? 0, (a.count ?? 0) > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right tabular-nums text-primary">
                    {a.percentage === null ? (
                      <DeiNoValue />
                    ) : (
                      `${a.count ?? 0} · ${formatPercent(a.percentage, locale)}`
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-center text-callout text-secondary">
            {formatMessage(t.dei.ageTotal, { total: formatNumber(total, locale) })}
          </p>
        </>
      )}
    </section>
  );
}

export function NationalityDiversity() {
  const { t, locale } = useI18n();
  const countryName = useCountryName();
  const q = useDeiNationalityDiversity();

  return (
    <section aria-labelledby="dei-nationality" className={DEI_CARD}>
      <h2 id="dei-nationality" className={DEI_CARD_TITLE}>
        {t.dei.nationalityDiversity}
      </h2>
      {q.isLoading ? (
        <DeiCardSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.dei.errNationality} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.distribution.length === 0 ? (
        <EmptyState size="compact" title={t.dei.noNationality} />
      ) : (
        <ul className="space-y-1.5">
          {q.data.distribution.map((n, i) => (
            <li key={n.nationality} className="flex items-center justify-between gap-2 text-callout">
              <span className="min-w-0 truncate text-primary">{countryName(n.nationality)}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="h-3 w-24 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                  {/* min-5 suppressed nationalities (1..4 people) render no bar and a masked label. */}
                  <span
                    className={`block h-3 rounded-full ${RAMP[Math.min(i, RAMP.length - 1)]}`}
                    style={{ width: `${n.percentage ?? 0}%` }}
                  />
                </span>
                <span className="w-12 text-right font-medium tabular-nums text-primary">
                  {n.percentage === null ? <DeiNoValue /> : formatPercent(n.percentage, locale)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HiringFunnel() {
  const { t, locale } = useI18n();
  const q = useDeiHiringFunnel();

  return (
    <section aria-labelledby="dei-candidates" className={DEI_CARD}>
      <h2 id="dei-candidates" className={DEI_CARD_TITLE}>
        {t.dei.candidatePipeline}
      </h2>
      {q.isLoading ? (
        <DeiCardSkeleton rows={2} />
      ) : q.isError ? (
        <ErrorState size="compact" title={t.dei.errPipeline} error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="text-display font-semibold tabular-nums text-primary">
            {formatNumber(q.data?.total ?? 0, locale)}
          </p>
          <p className="mt-1 text-callout text-secondary">{t.dei.candidatesTotalNote}</p>
        </>
      )}
    </section>
  );
}
