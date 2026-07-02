'use client';

import { ErrorState } from '../../../../components';

interface PerformanceKpi {
  label: string;
  value: string | number;
  valueColor?: string;
  change?: { text: string; color: string };
  extra?: React.ReactNode;
  progressBar?: { pct: number; color: string };
}

interface PerformanceKpisProps {
  kpis: PerformanceKpi[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export function PerformanceKpis({ kpis, isLoading, isError, onRetry }: PerformanceKpisProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
            <div className="h-3 w-24 bg-gray-200 rounded animate-pulse mb-3" />
            <div className="h-7 w-14 bg-gray-200 rounded animate-pulse mb-2" />
            <div className="h-2 w-20 bg-gray-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="col-span-2 md:col-span-5">
          <ErrorState onRetry={onRetry} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4"
        >
          <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">
            {kpi.label}
          </div>
          <div className="flex items-end gap-2">
            <span
              className={`text-[22px] md:text-[28px] font-bold leading-none ${kpi.valueColor || 'text-[#333]'}`}
            >
              {kpi.value}
            </span>
            {kpi.change && (
              <span className={`text-[11px] font-medium mb-1 ${kpi.change.color}`}>
                {kpi.change.text}
              </span>
            )}
          </div>
          {kpi.progressBar && (
            <div className="w-full h-1.5 bg-[#EDEDED] rounded-full mt-2">
              <div
                className={`h-full rounded-full ${kpi.progressBar.color}`}
                style={{ width: `${kpi.progressBar.pct}%` }}
              />
            </div>
          )}
          {kpi.extra && <div className="mt-2">{kpi.extra}</div>}
        </div>
      ))}
    </div>
  );
}
