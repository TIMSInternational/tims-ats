'use client';

import { Skeleton } from '../../../../components';

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
  t: { competencyCoverage: string; average: string };
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

/* Static demo data matching the HTML design */
const DEMO_COMPETENCIES = [
  { name: 'Liderazgo Estrategico', pct: 88 },
  { name: 'Gestion Financiera', pct: 82 },
  { name: 'Innovacion & Tecnologia', pct: 68 },
  { name: 'Desarrollo de Personas', pct: 65 },
  { name: 'Gestion Comercial', pct: 61 },
  { name: 'Operaciones & Supply Chain', pct: 47 },
  { name: 'Relaciones Institucionales', pct: 39 },
];

export function CompetencyCoverage({ data, loading, t }: CompetencyCoverageProps) {
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

  const items = data && data.length > 0
    ? data.map((d) => {
        const total = d.readyNow + d.readySoon;
        const pct = d.totalSuccessors > 0 ? Math.round((total / d.totalSuccessors) * 100) : 0;
        return { name: d.title, pct };
      })
    : DEMO_COMPETENCIES;

  const avg = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.pct, 0) / items.length) : 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.competencyCoverage}</h3>
        <span className="text-[10px] text-[#8B8B8B]">{t.average}: {avg}%</span>
      </div>
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
    </div>
  );
}
