'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { TalentPoolFilters } from './talent-pool-filters';
import { TalentPoolAiBar } from './talent-pool-ai-bar';
import { TalentPoolResultsHeader } from './talent-pool-results-header';
import { TalentPoolTable } from './talent-pool-table';

export default function TalentPoolsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
        <span className="text-sm font-medium text-[#1F114C]">{t.talentPool.title}</span>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t.talentPool.export}
          </button>
          <button className="flex items-center gap-1.5 bg-[#1F114C] text-white px-4 h-8 rounded-lg text-[12px] font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            {t.talentPool.recontactCampaign}
          </button>
          <button className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t.talentPool.addToPool}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Filters */}
        <TalentPoolFilters search={search} onSearchChange={setSearch} />

        {/* Right: Results */}
        <div className="flex-1 overflow-y-auto p-6">
          <TalentPoolResultsHeader />
          <TalentPoolAiBar />
          <TalentPoolTable />
        </div>
      </div>
    </div>
  );
}
