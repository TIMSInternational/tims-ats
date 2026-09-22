'use client';

import { KpiCardSkeleton, ErrorState } from '../../../components';

interface LearningKpisProps {
  data:
    | {
        totalCourses: number;
        totalEnrollments: number;
        avgProgress: number;
        totalCertificates: number;
        totalPaths: number;
      }
    | undefined;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  t: {
    kpiTotalCourses: string;
    kpiEnrollments: string;
    kpiAvgProgress: string;
    kpiCertifications: string;
  };
}

export function LearningKpis({ data, loading, isError, onRetry, t }: LearningKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
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

  const kpis = [
    {
      label: t.kpiTotalCourses,
      value: data?.totalCourses ?? 0,
    },
    {
      label: t.kpiEnrollments,
      value: data?.totalEnrollments ?? 0,
    },
    {
      label: t.kpiAvgProgress,
      value: `${data?.avgProgress ?? 0}%`,
    },
    {
      label: t.kpiCertifications,
      value: data?.totalCertificates ?? 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">{kpi.label}</p>
          <p className="text-[20px] md:text-[26px] font-bold text-[#1F114C]">{kpi.value}</p>
        </div>
      ))}
    </div>
  );
}
