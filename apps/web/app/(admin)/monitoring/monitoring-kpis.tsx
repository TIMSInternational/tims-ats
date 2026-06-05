'use client';

import { useI18n } from '../../../lib/i18n';

interface MonitoringKpisProps {
  data: {
    totalEmployees: number;
    activeVacancies: number;
    pendingAdjustments: number;
    activeSurveys: number;
    openAlerts: number;
  } | null;
  loading: boolean;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-14 bg-gray-100 rounded" /></div>;
}

export function MonitoringKpis({ data, loading }: MonitoringKpisProps) {
  const { t } = useI18n();

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  const items = [
    { label: t.monitoring.kpiHeadcount, value: data.totalEmployees, color: 'text-[#1F114C]' },
    { label: t.monitoring.kpiVacancies, value: data.activeVacancies, color: 'text-[#1F114C]' },
    { label: t.monitoring.kpiAlerts, value: data.openAlerts, color: data.openAlerts > 0 ? 'text-[#DD0C15]' : 'text-[#1F114C]' },
    { label: t.monitoring.kpiPending, value: data.pendingAdjustments, color: data.pendingAdjustments > 0 ? 'text-amber-500' : 'text-[#1F114C]' },
    { label: t.monitoring.kpiSurveys, value: data.activeSurveys, color: 'text-[#1F114C]' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
      {items.map((k) => (
        <div key={k.label} className="bg-white rounded-xl p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[10px] text-[#8B8B8B] mb-0.5 uppercase tracking-wide">{k.label}</p>
          <p className={`text-[20px] md:text-[26px] font-bold ${k.color} leading-tight`}>{k.value}</p>
        </div>
      ))}
    </div>
  );
}
