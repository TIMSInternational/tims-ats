'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../../components';

export default function TeamIntelligencePage() {
  const { t } = useI18n();
  const kpis = trpc.teamIntel.getDashboardKpis.useQuery();

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.teamIntel.title}</h1>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.data ? (
          <>
            <KpiCard
              label={t.teamIntel.kpiTeams}
              value={kpis.data.totalTeams}
              subtitle={`${kpis.data.totalMembers} ${t.teamIntel.kpiMembers.toLowerCase()}`}
              icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 21a8 8 0 00-16 0" /><circle cx="10" cy="8" r="5" /></svg>}
              iconBg="bg-[#1F114C]/10"
            />
            <KpiCard
              label={t.teamIntel.kpiMembers}
              value={kpis.data.totalMembers}
              subtitle={`${t.teamIntel.kpiAvgSize}: ${kpis.data.avgTeamSize}`}
              icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
              iconBg="bg-blue-50"
            />
            <KpiCard
              label={t.teamIntel.kpiAvgSize}
              value={kpis.data.avgTeamSize}
              subtitle={t.teamIntel.kpiMembers}
              icon={<svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" /></svg>}
              iconBg="bg-violet-50"
            />
            <KpiCard
              label={t.teamIntel.kpiLeaderless}
              value={kpis.data.teamsWithoutLeader}
              subtitle={kpis.data.teamsWithoutLeader > 0 ? t.common.requiresAttention : t.common.noIssues}
              valueColor={kpis.data.teamsWithoutLeader > 0 ? 'text-[#DD0C15]' : undefined}
              icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>}
              iconBg="bg-amber-50"
              highlight={kpis.data.teamsWithoutLeader > 0}
            />
          </>
        ) : null}
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex-1">
        <p className="text-sm text-[#8B8B8B] text-center py-8">
          {t.teamIntel.noTeams}
          <br />
          <span className="text-xs">{t.teamIntel.noTeamsDesc}</span>
        </p>
      </div>
    </div>
  );
}
