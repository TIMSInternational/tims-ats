'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatNumber, formatPercent } from '../../../../lib/format-utils';
import { KpiCard, KpiCardSkeleton } from '../../../../components';

interface ClimateKpisProps {
  enps: {
    enps: number | null;
    promoters: number | null;
    passives: number | null;
    detractors: number | null;
    totalResponses: number | null;
    suppressed?: boolean;
  } | null;
  // totalResponses is nulled by min-5 suppression (round 6) when 1..4 org-wide responses.
  dashKpis: {
    activeSurveys: number;
    totalResponses: number | null;
    totalResponsesSuppressed?: boolean;
    actionPlansOpen: number;
    highRiskCount: number;
  } | null;
  loading: boolean;
}

const GRID = 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5';

/** Climate KPIs on the shared KpiCard. With no responses the eNPS reads "—", never a coloured 0. */
export function ClimateKpis({ enps, dashKpis, loading }: ClimateKpisProps) {
  const { t, locale } = useI18n();

  if (loading) {
    return (
      <div className={GRID} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // eNPS is suppressed (min-5 k-anonymity) when the backend nulls its head-counts.
  const enpsSuppressed = enps?.suppressed === true || enps?.enps == null;
  const noResponses = !enpsSuppressed && (enps?.totalResponses ?? 0) === 0;
  const enpsScore = enps?.enps ?? 0;
  const enpsTone = enpsScore >= 30 ? 'success' : enpsScore >= 0 ? 'warning' : 'danger';
  const promoterPct =
    enps && enps.totalResponses && enps.promoters != null
      ? Math.round((enps.promoters / enps.totalResponses) * 100)
      : 0;
  const unavailable = enpsSuppressed ? t.climate.enpsSuppressed : noResponses ? t.climate.noResponsesYet : undefined;

  return (
    <div className={GRID}>
      <KpiCard
        label={t.climate.kpiEnps}
        value={`${enpsScore > 0 ? '+' : ''}${formatNumber(enpsScore, locale)}`}
        tone={enpsTone}
        unavailableReason={unavailable}
      />
      <KpiCard
        label={t.climate.kpiResponses}
        value={formatNumber(enps?.totalResponses ?? 0, locale)}
        unavailableReason={enpsSuppressed ? t.climate.enpsSuppressed : undefined}
      />
      <KpiCard label={t.climate.kpiActiveSurveys} value={formatNumber(dashKpis?.activeSurveys ?? 0, locale)} />
      <KpiCard label={t.climate.kpiOpenPlans} value={formatNumber(dashKpis?.actionPlansOpen ?? 0, locale)} />
      <KpiCard
        label={t.climate.kpiPromoters}
        value={formatNumber(enps?.promoters ?? 0, locale)}
        subtitle={formatPercent(promoterPct, locale)}
        unavailableReason={unavailable}
      />
    </div>
  );
}
