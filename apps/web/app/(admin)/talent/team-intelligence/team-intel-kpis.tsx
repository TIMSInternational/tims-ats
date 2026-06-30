'use client';

import { KpiCardSkeleton } from '../../../../components';

// A KPI value is either a real number or the honest-unavailable marker.
// Keep this union explicit so a future numeric formatter can't silently break on 'N/D'.
type KpiValue = number | 'N/D';

interface TeamIntelKpisProps {
  data: {
    totalTeams: number;
    totalMembers: number;
    avgTeamSize: number;
    teamsWithoutLeader: number;
    avgTenureYears: number;
    diversityIndex: number;
  } | undefined;
  loading: boolean;
  t: {
    kpiTeamSize: string;
    kpiAvgTenure: string;
    kpiPcaBalance: string;
    kpiDiversity: string;
    kpiAvgPerformance: string;
    activeMembers: string;
    years: string;
    score100: string;
    diversityRoles: string;
    outOf10: string;
  };
}

export function TeamIntelKpis({ data, loading, t }: TeamIntelKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const kpis: { label: string; value: KpiValue; sub: string }[] = [
    {
      label: t.kpiTeamSize,
      value: data?.totalMembers ?? 0,
      sub: t.activeMembers,
    },
    {
      label: t.kpiAvgTenure,
      value: data?.avgTenureYears ?? 0,
      sub: t.years,
    },
    {
      label: t.kpiPcaBalance,
      value: 'N/D',
      sub: t.score100,
    },
    {
      label: t.kpiDiversity,
      value: data?.diversityIndex ?? 0,
      sub: t.diversityRoles,
    },
    {
      label: t.kpiAvgPerformance,
      value: 'N/D',
      sub: t.outOf10,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">{kpi.label}</p>
          <p className="text-[22px] font-bold text-[#1F114C]">{kpi.value}</p>
          <p className="text-[10px] text-[#8B8B8B]">{kpi.sub}</p>
        </div>
      ))}
    </div>
  );
}
