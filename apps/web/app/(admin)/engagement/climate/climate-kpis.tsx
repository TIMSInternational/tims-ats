'use client';

import { useI18n } from '../../../../lib/i18n';

interface ClimateKpisProps {
  enps: { enps: number; promoters: number; passives: number; detractors: number; totalResponses: number } | null;
  dashKpis: { activeSurveys: number; totalResponses: number; actionPlansOpen: number; highRiskCount: number } | null;
  loading: boolean;
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

export function ClimateKpis({ enps, dashKpis, loading }: ClimateKpisProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  const enpsScore = enps?.enps ?? 0;
  const enpsColor = enpsScore >= 30 ? 'text-green-600' : enpsScore >= 0 ? 'text-amber-500' : 'text-[#DD0C15]';
  const promoterPct = enps && enps.totalResponses ? Math.round((enps.promoters / enps.totalResponses) * 100) : 0;

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      <Card label={t.climate.kpiEnps}>
        <p className={`text-[26px] font-bold ${enpsColor}`}>{enpsScore > 0 ? '+' : ''}{enpsScore}</p>
      </Card>
      <Card label={t.climate.kpiResponses}>
        <p className="text-[26px] font-bold text-[#1F114C]">{enps?.totalResponses ?? 0}</p>
      </Card>
      <Card label={t.climate.kpiActiveSurveys}>
        <p className="text-[26px] font-bold text-[#1F114C]">{dashKpis?.activeSurveys ?? 0}</p>
      </Card>
      <Card label={t.climate.kpiOpenPlans}>
        <p className={`text-[26px] font-bold ${(dashKpis?.actionPlansOpen ?? 0) > 0 ? 'text-[#DD0C15]' : 'text-[#1F114C]'}`}>{dashKpis?.actionPlansOpen ?? 0}</p>
      </Card>
      <Card label={t.climate.kpiPromoters} sub={`${promoterPct}%`}>
        <p className="text-[26px] font-bold text-green-600">{enps?.promoters ?? 0}</p>
      </Card>
    </div>
  );
}
