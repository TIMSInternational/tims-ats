'use client';

import { useI18n } from '../../../../lib/i18n';

export function TalentPoolResultsHeader() {
  const { t } = useI18n();

  const activeFilters = [
    { label: 'Node.js', style: 'bg-blue-50 text-blue-600', removable: true },
    { label: 'React', style: 'bg-blue-50 text-blue-600', removable: true },
    { label: 'Senior 5+', style: 'bg-[#1F114C] text-white', removable: false },
    { label: 'Bogota', style: 'bg-[#1F114C] text-white', removable: false },
    { label: 'FIT 60+', style: 'bg-teal-50 text-teal-600', removable: false },
  ];

  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-[#585858]">
          {t.talentPool.showing} <strong className="text-[#1F114C]">323</strong> {t.talentPool.candidatesLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {activeFilters.map((f) => (
            <span key={f.label} className={`text-[10px] ${f.style} px-2 py-0.5 rounded-full flex items-center gap-1`}>
              {f.label}
              {f.removable && (
                <button className="text-blue-400 hover:text-blue-600">x</button>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#8B8B8B]">{t.talentPool.sortBy}</span>
        <select className="text-[11px] text-[#1F114C] font-medium bg-white border border-[#EDEDED] rounded px-2 h-7 outline-none">
          <option>{t.talentPool.sortFit}</option>
          <option>{t.talentPool.sortRecent}</option>
          <option>{t.talentPool.sortName}</option>
          <option>{t.talentPool.sortExperience}</option>
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
