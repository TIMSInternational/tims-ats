'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../../components';

export default function RecruitmentAnalyticsPage() {
  const { t } = useI18n();
  const vacancyKpis = trpc.vacancy.getDashboardKpis.useQuery();
  const candidateKpis = trpc.candidate.getDashboardKpis.useQuery();
  const poolStats = trpc.candidate.getPoolStats.useQuery();

  const isLoading = vacancyKpis.isLoading || candidateKpis.isLoading;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.analytics}</h1>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={t.vacancies.kpiOpen}
                value={vacancyKpis.data?.totalOpen ?? 0}
                subtitle={`${vacancyKpis.data?.totalPublished ?? 0} ${t.vacancies.statusPublished.toLowerCase()}`}
                icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>}
                iconBg="bg-green-50"
              />
              <KpiCard
                label={t.candidates.kpiTotal}
                value={candidateKpis.data?.total ?? 0}
                subtitle={`${candidateKpis.data?.newThisMonth ?? 0} ${t.candidates.kpiNew.toLowerCase()}`}
                icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
                iconBg="bg-blue-50"
              />
              <KpiCard
                label={t.candidates.kpiActive}
                value={candidateKpis.data?.activeApplications ?? 0}
                subtitle={t.pipeline.title}
                icon={<svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></svg>}
                iconBg="bg-violet-50"
              />
              <KpiCard
                label={t.vacancies.kpiClosed}
                value={vacancyKpis.data?.totalClosed ?? 0}
                subtitle={`${(vacancyKpis.data?.totalOpen ?? 0) + (vacancyKpis.data?.totalClosed ?? 0)} total`}
                icon={<svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>}
                iconBg="bg-gray-100"
              />
            </>
          )}
        </div>

        {/* Source Breakdown */}
        {poolStats.data && poolStats.data.byPool.length > 0 && (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-6">
            <h3 className="text-sm font-semibold text-[#1F114C] mb-4">{t.candidates.colSource}</h3>
            <div className="space-y-3">
              {poolStats.data.byPool.map((pool) => {
                const pct = poolStats.data.total > 0 ? Math.round((pool.count / poolStats.data.total) * 100) : 0;
                return (
                  <div key={pool.poolType}>
                    <div className="flex justify-between text-[12px] mb-1">
                      <span className="text-[#585858]">{pool.poolType}</span>
                      <span className="text-[#1F114C] font-medium">{pool.count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-[#F6F6F6] rounded-full h-2">
                      <div className="bg-[#1F114C] h-2 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Vacancy Stats */}
        {vacancyKpis.data && (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#1F114C] mb-4">{t.sidebar.vacancies}</h3>
            <div className="grid grid-cols-5 gap-3">
              <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-[#1F114C]">{vacancyKpis.data.totalDraft}</p>
                <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.statusDraft}</p>
              </div>
              <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-amber-600">{vacancyKpis.data.totalPendingApproval}</p>
                <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.statusPendingApproval}</p>
              </div>
              <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-blue-600">{vacancyKpis.data.totalOpen}</p>
                <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.statusApproved}</p>
              </div>
              <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-green-600">{vacancyKpis.data.totalPublished}</p>
                <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.statusPublished}</p>
              </div>
              <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-[#8B8B8B]">{vacancyKpis.data.totalClosed}</p>
                <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.statusClosed}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
