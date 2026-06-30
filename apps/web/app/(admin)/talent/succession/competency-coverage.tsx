'use client';

import { Skeleton } from '../../../../components';
import { EmptyState } from '../../../../components/empty-state';

interface CoverageItem {
  roleId: string;
  title: string;
  totalSuccessors: number;
  readyNow: number;
  readySoon: number;
  coverageStatus: string;
}

interface CompetencyCoverageProps {
  data: CoverageItem[] | undefined;
  loading: boolean;
  isError: boolean;
  t: {
    competencyCoverage: string;
    average: string;
    competencyCoverageEmpty: string;
    competencyCoverageEmptyDesc: string;
    loadError: string;
  };
}

function getBarColor(pct: number) {
  if (pct >= 70) return 'bg-green-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-[#DD0C15]';
}

function getTextColor(pct: number) {
  if (pct >= 70) return 'text-green-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-[#DD0C15]';
}

export function CompetencyCoverage({ data, loading, isError, t }: CompetencyCoverageProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
        <Skeleton className="h-4 w-48 mb-3" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full mb-2" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
        <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.competencyCoverage}</h3>
        <p className="text-[12px] text-[#DD0C15]">{t.loadError}</p>
      </div>
    );
  }

  const items = data && data.length > 0
    ? data.map((d) => {
        const total = d.readyNow + d.readySoon;
        const pct = d.totalSuccessors > 0 ? Math.round((total / d.totalSuccessors) * 100) : 0;
        return { name: d.title, pct };
      })
    : [];

  const avg = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.pct, 0) / items.length) : 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.competencyCoverage}</h3>
        {items.length > 0 && (
          <span className="text-[10px] text-[#8B8B8B]">{t.average}: {avg}%</span>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-8 h-8 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5" />
            </svg>
          }
          message={t.competencyCoverageEmpty}
          description={t.competencyCoverageEmptyDesc}
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.name}>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] text-[#585858]">{item.name}</span>
                <span className={`text-[10px] font-semibold ${getTextColor(item.pct)}`}>{item.pct}%</span>
              </div>
              <div className="w-full h-2 bg-[#F6F6F6] rounded-full">
                <div className={`h-2 ${getBarColor(item.pct)} rounded-full`} style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
