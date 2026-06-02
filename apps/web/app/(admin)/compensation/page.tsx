'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { CompKpis } from './comp-kpis';
import { SalaryBands, PayEquityCard } from './comp-left-column';
import { CompaRatioDistribution, BenefitsUtilization, PendingAdjustments } from './comp-right-column';
import { MarketCompetitiveness, TotalCompBreakdown } from './comp-bottom-row';

export default function CompensationPage() {
  const { t } = useI18n();
  const kpis = trpc.compensation.getDashboardKpis.useQuery();

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-7 h-14 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-[#8B8B8B]">People</span>
          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
          <span className="text-[#333] font-semibold">{t.sidebar.compensation}</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-[12px] border border-[#EDEDED] rounded-lg px-4 py-1.5 text-[#585858] hover:bg-gray-50 font-medium">Exportar</button>
          <button className="text-[12px] bg-[#DD0C15] text-white rounded-lg px-4 py-1.5 font-medium hover:bg-red-700">Simular Ajuste</button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <CompKpis data={kpis.data ?? null} loading={kpis.isLoading} />

        {/* Main Two-Column */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-7 space-y-4">
            <SalaryBands />
            <PayEquityCard />
          </div>
          <div className="col-span-5 space-y-4">
            <CompaRatioDistribution />
            <BenefitsUtilization />
            <PendingAdjustments />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-12 gap-4">
          <MarketCompetitiveness />
          <TotalCompBreakdown />
        </div>
      </div>
    </div>
  );
}
