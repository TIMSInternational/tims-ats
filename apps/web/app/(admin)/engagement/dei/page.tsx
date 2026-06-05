'use client';

import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { DeiKpis } from './dei-kpis';
import { GenderByDepartment, PayEquityTable } from './dei-left-column';
import { AgeDistribution, NationalityDiversity, HiringFunnel } from './dei-right-column';
import { PromotionEquity, LeadershipDiversity, InclusionTrend } from './dei-bottom-row';

export default function DeiPage() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.dei.breadcrumbParent}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.sidebar.dei}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => toast(`${t.common.export}: ${t.common.comingSoon}`, { type: 'info' })} className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            {t.common.export}
          </button>
          <button onClick={() => toast(`${t.dei.generateReport}: ${t.common.comingSoon}`, { type: 'info' })} className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            {t.dei.generateReport}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <DeiKpis />

        {/* Main 2-Column */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="flex flex-col gap-4 w-full md:w-[55%]">
            <GenderByDepartment />
            <PayEquityTable />
          </div>
          <div className="flex flex-col gap-4 w-full md:w-[45%]">
            <AgeDistribution />
            <NationalityDiversity />
            <HiringFunnel />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PromotionEquity />
          <LeadershipDiversity />
          <InclusionTrend />
        </div>
      </div>
    </div>
  );
}
