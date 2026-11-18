'use client';

import { useI18n, formatMessage } from '../../../../lib/i18n';
import { formatNumber, formatPercent } from '../../../../lib/format-utils';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import {
  useDeiDashboardKpis,
  useDeiGenderRepresentation,
  useDeiPayEquity,
  useDeiInclusionIndex,
} from '../../../../lib/platform-api/dei';
import { DeiGenderRatioKpi } from './dei-gender-ratio-kpi';

const GRID = 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5';

export function DeiKpis() {
  const { t, locale } = useI18n();
  const kpis = useDeiDashboardKpis();
  const genders = useDeiGenderRepresentation();
  const pay = useDeiPayEquity();
  const inclusion = useDeiInclusionIndex();

  if (kpis.isLoading) {
    return (
      <div className={GRID} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (kpis.isError || !kpis.data || genders.isError || pay.isError || inclusion.isError) {
    return (
      <div className="mb-4 rounded-xl border border-border bg-white shadow-card">
        <ErrorState
          size="compact"
          title={t.dei.errKpis}
          error={kpis.error ?? genders.error ?? pay.error ?? inclusion.error}
          onRetry={() => {
            kpis.refetch();
            genders.refetch();
            pay.refetch();
            inclusion.refetch();
          }}
        />
      </div>
    );
  }

  const d = kpis.data;
  // Suppressed gender distribution (round 7) returns empty groups → ratio bar shows 0%
  // for all (never a real share). Read from the { groups, suppressed } shape.
  const byGender = Object.fromEntries((genders.data?.groups ?? []).map((g) => [g.gender, g.percentage ?? 0]));
  const gap = pay.data?.gapPct;
  const gapTone = gap == null ? undefined : Math.abs(gap) < 3 ? 'success' : Math.abs(gap) <= 5 ? 'warning' : 'danger';
  const inclusionIndex = inclusion.data?.index;

  return (
    <div className={GRID}>
      <DeiGenderRatioKpi male={byGender.male ?? 0} female={byGender.female ?? 0} nonBinary={byGender.non_binary ?? 0} />

      {/* Parity index — null when any gender group is min-5 suppressed (cross-endpoint differencing guard). */}
      <KpiCard
        label={t.dei.kpiParity}
        value={
          d.genderParityIndex === null
            ? '—'
            : formatNumber(d.genderParityIndex, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }
        subtitle={
          d.womenPct === null
            ? formatMessage(t.dei.kpiParityHint, { one: formatNumber(1, locale, { minimumFractionDigits: 1 }) })
            : formatMessage(t.dei.womenShare, { pct: formatPercent(d.womenPct, locale) })
        }
        unavailableReason={d.genderParityIndex === null ? t.dei.noData : undefined}
      />

      <KpiCard
        label={t.dei.kpiPayGap}
        value={gap == null ? '—' : `${gap > 0 ? '+' : ''}${formatPercent(gap, locale, 1)}`}
        subtitle={t.dei.kpiPayGapHint}
        tone={gapTone}
        unavailableReason={gap == null ? t.dei.noData : undefined}
      />

      <KpiCard
        label={t.dei.kpiInclusion}
        value={inclusionIndex == null ? '—' : formatNumber(inclusionIndex, locale)}
        subtitle={t.dei.kpiInclusionHint}
        unavailableReason={inclusionIndex == null ? t.dei.noData : undefined}
      />

      <KpiCard
        label={t.dei.kpiCoverage}
        value={d.demographicsCoverage === null ? '—' : formatPercent(d.demographicsCoverage, locale)}
        subtitle={formatMessage(t.dei.coverageCaption, {
          employees: formatNumber(d.totalEmployees, locale),
          nationalities: d.totalNationalities === null ? '—' : formatNumber(d.totalNationalities, locale),
        })}
        unavailableReason={d.demographicsCoverage === null ? t.dei.noData : undefined}
      />
    </div>
  );
}
