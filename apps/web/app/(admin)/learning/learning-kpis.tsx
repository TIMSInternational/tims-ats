'use client';

import { KpiCardSkeleton } from '../../../components';

interface LearningKpisProps {
  data: {
    totalCourses: number;
    totalEnrollments: number;
    avgProgress: number;
    totalCertificates: number;
    totalPaths: number;
  } | undefined;
  loading: boolean;
  t: {
    kpiTotalCourses: string;
    kpiActiveLearners: string;
    kpiAvgHours: string;
    kpiCertifications: string;
    kpiGapReduction: string;
    perEmployeeMonth: string;
    vsLastEval: string;
  };
}

export function LearningKpis({ data, loading, t }: LearningKpisProps) {
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
      label: t.kpiTotalCourses,
      value: data?.totalCourses ?? 0,
      sub: `+6 este trimestre`,
      subColor: 'text-green-500',
    },
    {
      label: t.kpiActiveLearners,
      value: data?.totalEnrollments ?? 0,
      sub: `+18 vs mes anterior`,
      subColor: 'text-green-500',
    },
    {
      label: t.kpiAvgHours,
      value: `${data?.avgProgress ?? 0}h`,
      sub: t.perEmployeeMonth,
      subColor: 'text-[#8B8B8B]',
    },
    {
      label: t.kpiCertifications,
      value: data?.totalCertificates ?? 0,
      valueColor: 'text-green-600',
      sub: `+22 este mes`,
      subColor: 'text-green-500',
    },
    {
      label: t.kpiGapReduction,
      value: '31%',
      valueColor: 'text-green-600',
      sub: t.vsLastEval,
      subColor: 'text-green-500',
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center"
        >
          <p className="text-[11px] text-[#8B8B8B] mb-1">{kpi.label}</p>
          <p className={`text-[26px] font-bold ${kpi.valueColor ?? 'text-[#1F114C]'}`}>
            {kpi.value}
          </p>
          <p className={`text-[10px] font-medium ${kpi.subColor}`}>{kpi.sub}</p>
        </div>
      ))}
    </div>
  );
}
