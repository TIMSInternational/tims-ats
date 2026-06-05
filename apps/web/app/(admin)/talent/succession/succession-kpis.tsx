'use client';

import { KpiCardSkeleton } from '../../../../components';

interface SuccessionKpisProps {
  data: {
    totalCriticalRoles: number;
    readyNowCount: number;
    rolesWithoutSuccessor: number;
    highFlightRiskRoles: number;
    totalSuccessors: number;
  } | undefined;
  loading: boolean;
  t: {
    kpiCriticalRoles: string;
    kpiReadyNow: string;
    kpi1to2Years: string;
    kpiNoSuccessor: string;
    kpiFlightRisk: string;
    identifiedInOrg: string;
    readyImmediately: string;
    activeDevelopment: string;
    requiresImmediate: string;
    keyEmployeesAtRisk: string;
  };
}

export function SuccessionKpis({ data, loading, t }: SuccessionKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const kpis = [
    {
      label: t.kpiCriticalRoles,
      value: data?.totalCriticalRoles ?? 18,
      sub: t.identifiedInOrg,
      iconBg: 'bg-[#1F114C]/10',
      iconColor: 'text-[#1F114C]',
      valueColor: 'text-[#1F114C]',
      icon: <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />,
    },
    {
      label: t.kpiReadyNow,
      value: data?.readyNowCount ?? 12,
      sub: t.readyImmediately,
      iconBg: 'bg-green-50',
      iconColor: 'text-green-600',
      valueColor: 'text-green-600',
      icon: <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    },
    {
      label: t.kpi1to2Years,
      value: (data?.totalSuccessors ?? 9) - (data?.readyNowCount ?? 0),
      sub: t.activeDevelopment,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      valueColor: 'text-amber-600',
      icon: <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />,
    },
    {
      label: t.kpiNoSuccessor,
      value: data?.rolesWithoutSuccessor ?? 5,
      sub: t.requiresImmediate,
      iconBg: 'bg-red-50',
      iconColor: 'text-[#DD0C15]',
      valueColor: 'text-[#DD0C15]',
      highlight: true,
      subColor: 'text-[#DD0C15]',
      icon: <><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /><path d="M12 15.75h.007v.008H12v-.008z" /></>,
    },
    {
      label: t.kpiFlightRisk,
      value: data?.highFlightRiskRoles ?? 7,
      sub: t.keyEmployeesAtRisk,
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-600',
      valueColor: 'text-orange-600',
      icon: <><path d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /><path d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" /></>,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 ${kpi.highlight ? 'border border-red-200' : ''}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[11px] font-medium ${kpi.highlight ? 'text-[#DD0C15]' : 'text-[#8B8B8B]'}`}>
              {kpi.label}
            </span>
            <div className={`w-7 h-7 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
              <svg className={`w-4 h-4 ${kpi.iconColor}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                {kpi.icon}
              </svg>
            </div>
          </div>
          <p className={`text-[20px] md:text-[24px] font-bold ${kpi.valueColor}`}>{kpi.value}</p>
          <p className={`text-[10px] mt-1 ${kpi.subColor ?? 'text-[#8B8B8B]'}`}>{kpi.sub}</p>
        </div>
      ))}
    </div>
  );
}
