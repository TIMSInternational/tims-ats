'use client';

import { useI18n } from '../../../../lib/i18n';
import type { TalentPoolFilterState } from './page';

interface ResultsHeaderProps {
  totalCount: number;
  filters: TalentPoolFilterState;
  onFilterChange: <K extends keyof TalentPoolFilterState>(key: K, value: TalentPoolFilterState[K]) => void;
}

interface FilterPill {
  label: string;
  key: keyof TalentPoolFilterState;
  value: string;
  style: string;
}

export function TalentPoolResultsHeader({ totalCount, filters, onFilterChange }: ResultsHeaderProps) {
  const { t } = useI18n();
  const tp = t.talentPool;

  const pills: FilterPill[] = [];

  for (const skill of filters.skills) {
    pills.push({ label: skill, key: 'skills', value: skill, style: 'bg-blue-50 text-blue-600' });
  }
  for (const loc of filters.locations) {
    pills.push({ label: loc, key: 'locations', value: loc, style: 'bg-[#1F114C] text-white' });
  }
  for (const exp of filters.experienceLevels) {
    pills.push({ label: tp[exp as keyof typeof tp] ?? exp, key: 'experienceLevels', value: exp, style: 'bg-[#1F114C] text-white' });
  }
  if (filters.fitMin > 0) {
    pills.push({ label: `FIT ${filters.fitMin}+`, key: 'fitMin', value: '0', style: 'bg-teal-50 text-teal-600' });
  }
  for (const pt of filters.poolTypes) {
    pills.push({ label: pt, key: 'poolTypes', value: pt, style: 'bg-amber-50 text-amber-600' });
  }

  const removePill = (pill: FilterPill) => {
    if (pill.key === 'fitMin') {
      onFilterChange('fitMin', 0);
    } else {
      const current = filters[pill.key];
      if (Array.isArray(current)) {
        onFilterChange(pill.key, current.filter((v: string) => v !== pill.value) as never);
      }
    }
  };

  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-[#585858]">
          {tp.showing} <strong className="text-[#1F114C]">{totalCount}</strong> {tp.candidatesLabel}
        </span>
        {pills.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {pills.map((pill) => (
              <span
                key={`${pill.key}-${pill.value}`}
                className={`text-[10px] ${pill.style} px-2 py-0.5 rounded-full flex items-center gap-1`}
              >
                {pill.label}
                <button onClick={() => removePill(pill)} className="opacity-60 hover:opacity-100 ml-0.5">x</button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#8B8B8B]">{tp.sortBy}</span>
        <select
          value={filters.sort}
          onChange={(e) => onFilterChange('sort', e.target.value)}
          className="text-[11px] text-[#1F114C] font-medium bg-white border border-[#EDEDED] rounded px-2 h-7 outline-none"
        >
          <option value="fit">{tp.sortFit}</option>
          <option value="recent">{tp.sortRecent}</option>
          <option value="name">{tp.sortName}</option>
          <option value="experience">{tp.sortExperience}</option>
        </select>
        <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden ml-2">
          <button className="px-2.5 h-7 bg-[#1F114C] text-white text-[11px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
            </svg>
          </button>
          <button className="px-2.5 h-7 text-[#585858] text-[11px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
