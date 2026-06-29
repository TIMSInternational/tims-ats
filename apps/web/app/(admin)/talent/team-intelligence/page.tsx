'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { TeamIntelKpis } from './team-intel-kpis';
import { PcaProfile } from './pca-profile';
import { TeamComposition } from './team-composition';
import { TeamMembersTable } from './team-members-table';
import { BalanceAlerts } from './balance-alerts';
import { RecommendedHires } from './recommended-hires';
import { TeamComparison } from './team-comparison';

export default function TeamIntelligencePage() {
  const { t } = useI18n();
  const kpis = trpc.teamIntel.getDashboardKpis.useQuery();

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.teamIntel.breadcrumb}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.teamIntel.title}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border border-[#EDEDED] rounded-lg px-3 h-8">
            <svg className="w-3.5 h-3.5 text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            <span className="text-[12px] text-[#585858]">{t.teamIntel.teamSelector}:</span>
            <span className="text-[12px] font-medium text-[#1F114C]">Tecnologia</span>
            <svg className="w-3 h-3 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
          <button onClick={() => toast(`${t.common.export}: ${t.common.comingSoon}`, { type: 'info' })} className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t.teamIntel.export}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <TeamIntelKpis data={kpis.data} loading={kpis.isLoading} t={t.teamIntel} />

        {/* Main 2-column */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          {/* Left Column (55%) */}
          <div className="flex flex-col gap-4" style={{ width: '55%' }}>
            <PcaProfile t={t.teamIntel} />
            <TeamComposition t={t.teamIntel} />
          </div>

          {/* Right Column (45%) */}
          <div className="flex flex-col gap-4" style={{ width: '45%' }}>
            <TeamMembersTable t={t.teamIntel} />
            <BalanceAlerts t={t.teamIntel} />
            <RecommendedHires t={t.teamIntel} />
          </div>
        </div>

        {/* Bottom: Team Comparison */}
        <TeamComparison t={t.teamIntel} />
      </div>
    </div>
  );
}
