'use client';

import { KpiCardSkeleton } from '../../../../components';

interface TeamIntelKpisProps {
  data: {
    totalTeams: number;
    totalMembers: number;
    avgTeamSize: number;
    teamsWithoutLeader: number;
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
    shannonIndex: string;
    outOf10: string;
    needsBalance: string;
  };
}

export function TeamIntelKpis({ data, loading, t }: TeamIntelKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const kpis = [
    {
      label: t.kpiTeamSize,
      value: data?.totalMembers ?? 12,
      sub: t.activeMembers,
      trend: '+2 vs Q1',
      trendColor: 'text-green-500',
      trendUp: true,
    },
    {
      label: t.kpiAvgTenure,
      value: '2.8',
      sub: t.years,
      trend: '+0.3 vs anterior',
      trendColor: 'text-green-500',
      trendUp: true,
    },
    {
      label: t.kpiPcaBalance,
      value: 68,
      valueColor: 'text-amber-500',
      sub: t.score100,
      trend: t.needsBalance,
      trendColor: 'text-amber-500',
      trendUp: false,
      trendIcon: 'warning',
    },
    {
      label: t.kpiDiversity,
      value: '0.72',
      sub: t.shannonIndex,
      trend: '+0.05 vs anterior',
      trendColor: 'text-green-500',
      trendUp: true,
    },
    {
      label: t.kpiAvgPerformance,
      value: '8.2',
      valueColor: 'text-green-600',
      sub: t.outOf10,
      trend: '+0.4 vs anterior',
      trendColor: 'text-green-500',
      trendUp: true,
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">{kpi.label}</p>
          <p className={`text-[22px] font-bold ${kpi.valueColor ?? 'text-[#1F114C]'}`}>{kpi.value}</p>
          <p className="text-[10px] text-[#8B8B8B]">{kpi.sub}</p>
          <div className="flex items-center justify-center gap-1 mt-1">
            {kpi.trendIcon === 'warning' ? (
              <svg className={`w-3 h-3 ${kpi.trendColor}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            ) : (
              <svg className={`w-3 h-3 ${kpi.trendColor}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            )}
            <span className={`text-[10px] ${kpi.trendColor} font-medium`}>{kpi.trend}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
