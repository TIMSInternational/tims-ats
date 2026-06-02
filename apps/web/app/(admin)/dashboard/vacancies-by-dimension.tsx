'use client';

import { useState } from 'react';
import { useI18n } from '../../../lib/i18n';

type DimensionTab = 'country' | 'city' | 'unit' | 'leader';

interface DimensionItem {
  label: string;
  count: number;
  pct: number;
  color: string;
}

// TODO: wire to API when endpoint is available
// Need a new endpoint: vacancy.getVacanciesByDimension({ dimension: 'country'|'city'|'unit'|'leader' })
// that groups open vacancies by the requested dimension and returns label + count.
const DIMENSION_DATA: Record<DimensionTab, DimensionItem[]> = {
  country: [
    { label: 'Colombia', count: 14, pct: 65, color: 'bg-[#1F114C]' },
    { label: 'Peru', count: 6, pct: 25, color: 'bg-teal-500' },
    { label: 'Argentina', count: 3, pct: 8, color: 'bg-amber-500' },
    { label: 'Mexico', count: 1, pct: 2, color: 'bg-[#8B8B8B]' },
  ],
  city: [
    { label: 'Bogota', count: 10, pct: 42, color: 'bg-[#1F114C]' },
    { label: 'Lima', count: 5, pct: 21, color: 'bg-teal-500' },
    { label: 'Medellin', count: 4, pct: 17, color: 'bg-violet-500' },
    { label: 'Buenos Aires', count: 3, pct: 12, color: 'bg-amber-500' },
    { label: 'CDMX', count: 2, pct: 8, color: 'bg-[#8B8B8B]' },
  ],
  unit: [
    { label: 'Engineering', count: 9, pct: 38, color: 'bg-[#1F114C]' },
    { label: 'Sales', count: 7, pct: 29, color: 'bg-teal-500' },
    { label: 'Operations', count: 5, pct: 21, color: 'bg-amber-500' },
    { label: 'HR', count: 3, pct: 12, color: 'bg-[#8B8B8B]' },
  ],
  leader: [
    { label: 'Laura G.', count: 8, pct: 33, color: 'bg-[#1F114C]' },
    { label: 'Andres T.', count: 6, pct: 25, color: 'bg-teal-500' },
    { label: 'Maria L.', count: 5, pct: 21, color: 'bg-violet-500' },
    { label: 'Carlos R.', count: 5, pct: 21, color: 'bg-amber-500' },
  ],
};

const DOT_COLORS = ['bg-[#1F114C]', 'bg-teal-500', 'bg-amber-500', 'bg-[#8B8B8B]', 'bg-violet-500'];

interface VacanciesByDimensionProps {
  totalOpen: number;
}

export function VacanciesByDimension({ totalOpen }: VacanciesByDimensionProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  const [activeTab, setActiveTab] = useState<DimensionTab>('country');

  const tabs: { key: DimensionTab; label: string }[] = [
    { key: 'country', label: rd.country },
    { key: 'city', label: rd.city },
    { key: 'unit', label: rd.unit },
    { key: 'leader', label: rd.leader },
  ];

  const items = DIMENSION_DATA[activeTab];
  const total = totalOpen || items.reduce((s, i) => s + i.count, 0);

  return (
    <div className="flex-[35] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <span className="text-base font-semibold text-[#1F114C] block mb-3">
        {rd.vacanciesByDimension}
      </span>
      {/* Tabs */}
      <div className="flex gap-3 mb-4 border-b border-[#EDEDED] pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`text-[13px] pb-2 ${
              activeTab === tab.key
                ? 'text-[#1F114C] font-medium border-b-2 border-[#DD0C15]'
                : 'text-[#8B8B8B]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Donut + Legend */}
      <div className="flex gap-6">
        <div className="flex flex-col items-center">
          <div className="w-[120px] h-[120px] rounded-full border-[16px] border-[#1F114C] flex items-center justify-center">
            <span className="text-xl font-bold text-[#1F114C]">{total}</span>
          </div>
          <span className="text-[11px] text-[#585858] mt-2">{rd.totalVacancies}</span>
        </div>
        <div className="flex flex-col gap-3 flex-1">
          {items.map((item, idx) => (
            <div key={item.label}>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${DOT_COLORS[idx] ?? 'bg-gray-400'}`} />
                <span className="text-xs text-[#333]">{item.label}</span>
                <span className="text-xs text-[#1F114C] font-medium ml-auto">{item.count}</span>
                <span className="text-[11px] text-[#585858]">{item.pct}%</span>
              </div>
              {idx < items.length - 1 && (
                <div className="w-full bg-[#F6F6F6] rounded-sm h-1.5 mt-1">
                  <div
                    className={`h-1.5 rounded-sm ${DOT_COLORS[idx] ?? 'bg-gray-400'}`}
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function VacanciesByDimensionSkeleton() {
  return (
    <div className="flex-[35] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-5 w-40 bg-gray-200 rounded mb-3" />
      <div className="h-4 w-full bg-gray-200 rounded mb-4" />
      <div className="flex gap-6">
        <div className="w-[120px] h-[120px] rounded-full bg-gray-200" />
        <div className="flex-1 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
