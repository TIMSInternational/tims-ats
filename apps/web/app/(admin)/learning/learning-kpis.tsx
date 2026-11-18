'use client';

import { KpiCardSkeleton, ErrorState } from '../../../components';
import { isForbiddenError } from '../../../lib/forbidden-error';

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
  /** The query's error: a permission denial hides the strip instead of offering a retry. */
  error?: unknown;
  onRetry?: () => void;
  t: {
    kpiTotalCourses: string;
    kpiEnrollments: string;
    kpiAvgProgress: string;
    kpiCertifications: string;
  };
}

export function LearningKpis({ data, loading, isError, error, onRetry, t }: LearningKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    // Employees and leaders may not read org KPIs; the catalog below still works for them.
    if (isForbiddenError(error)) return null;
    return <ErrorState size="compact" error={error} onRetry={onRetry} />;
  }

  const kpis = [
    { label: t.kpiTotalCourses, value: data?.totalCourses ?? 0 },
    { label: t.kpiEnrollments, value: data?.totalEnrollments ?? 0 },
    { label: t.kpiAvgProgress, value: `${data?.avgProgress ?? 0}%` },
    { label: t.kpiCertifications, value: data?.totalCertificates ?? 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="rounded-xl border border-border bg-white p-4 shadow-card">
          <p className="mb-1 text-callout font-medium text-secondary">{kpi.label}</p>
          <p className="font-display text-title font-semibold tabular-nums text-primary md:text-display">{kpi.value}</p>
        </div>
      ))}
    </div>
  );
}
