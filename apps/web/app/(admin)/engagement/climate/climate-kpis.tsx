'use client';

import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';

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
  dashKpis: { activeSurveys: number; totalResponses: number | null; totalResponsesSuppressed?: boolean; actionPlansOpen: number; highRiskCount: number } | null;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-16 bg-gray-100 rounded" /></div>;
}

function Card({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
      <p className="text-[11px] text-[#8B8B8B] mb-1">{label}</p>
      {children}
      {sub && <p className="text-[10px] text-[#8B8B8B] mt-1">{sub}</p>}
    </div>
  );
}

export function ClimateKpis({ enps, dashKpis, loading, isError, onRetry }: ClimateKpisProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mb-4">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  // eNPS is suppressed (min-5 k-anonymity) when the backend nulls its head-counts.
  const enpsSuppressed = enps?.suppressed === true || enps?.enps == null;
  const enpsScore = enps?.enps ?? 0;
  const enpsColor = enpsScore >= 30 ? 'text-green-600' : enpsScore >= 0 ? 'text-amber-500' : 'text-[#DD0C15]';
  const promoterPct =
    enps && enps.totalResponses && enps.promoters != null
      ? Math.round((enps.promoters / enps.totalResponses) * 100)
      : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      <Card label={t.climate.kpiEnps} sub={enpsSuppressed ? t.climate.enpsSuppressed : undefined}>
        {enpsSuppressed ? (
          <p className="text-[20px] md:text-[26px] font-bold text-[#8B8B8B]">—</p>
        ) : (
          <p className={`text-[20px] md:text-[26px] font-bold ${enpsColor}`}>{enpsScore > 0 ? '+' : ''}{enpsScore}</p>
        )}
      </Card>
      <Card label={t.climate.kpiResponses}>
        <p className="text-[20px] md:text-[26px] font-bold text-[#1F114C]">{enpsSuppressed ? '—' : enps?.totalResponses ?? 0}</p>
      </Card>
      <Card label={t.climate.kpiActiveSurveys}>
        <p className="text-[20px] md:text-[26px] font-bold text-[#1F114C]">{dashKpis?.activeSurveys ?? 0}</p>
      </Card>
      <Card label={t.climate.kpiOpenPlans}>
        <p className={`text-[20px] md:text-[26px] font-bold ${(dashKpis?.actionPlansOpen ?? 0) > 0 ? 'text-[#DD0C15]' : 'text-[#1F114C]'}`}>{dashKpis?.actionPlansOpen ?? 0}</p>
      </Card>
      <Card label={t.climate.kpiPromoters} sub={enpsSuppressed ? undefined : `${promoterPct}%`}>
        <p className="text-[20px] md:text-[26px] font-bold text-green-600">{enpsSuppressed ? '—' : enps?.promoters ?? 0}</p>
      </Card>
    </div>
  );
}
