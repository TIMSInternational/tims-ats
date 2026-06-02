'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../components';

interface RecruitmentDashboardProps {
  roleSlugs: string[];
}

const RECRUITER_ROLES = ['super_admin', 'hr_admin', 'recruiter', 'hrbp'];
const LEADER_ROLES = ['leader', 'committee'];

export function RecruitmentDashboard({ roleSlugs }: RecruitmentDashboardProps) {
  const { t } = useI18n();
  const isRecruiter = roleSlugs.some((r) => RECRUITER_ROLES.includes(r));
  const isLeader = roleSlugs.some((r) => LEADER_ROLES.includes(r));
  const isEmployee = !isRecruiter && !isLeader;

  if (isRecruiter) return <RecruiterDashboard />;
  if (isLeader) return <LeaderDashboard />;
  return <EmployeeDashboard />;
}

function RecruiterDashboard() {
  const { t } = useI18n();
  const vacancyKpis = trpc.vacancy.getDashboardKpis.useQuery();
  const candidateKpis = trpc.candidate.getDashboardKpis.useQuery();

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.commandCenter}</h1>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {vacancyKpis.isLoading || candidateKpis.isLoading ? (
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
                label={t.vacancies.kpiPending}
                value={vacancyKpis.data?.totalPendingApproval ?? 0}
                subtitle={t.vacancies.awaitingReview}
                icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>}
                iconBg="bg-amber-50"
                highlight={(vacancyKpis.data?.totalPendingApproval ?? 0) > 0}
              />
            </>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-6">
          <h3 className="text-sm font-semibold text-[#1F114C] mb-4">{t.common.actions}</h3>
          <div className="grid grid-cols-4 gap-3">
            <Link href="/recruitment/vacancies" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.vacancies}</span>
            </Link>
            <Link href="/recruitment/candidates" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.candidates}</span>
            </Link>
            <Link href="/recruitment/pipeline" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.pipeline}</span>
            </Link>
            <Link href="/recruitment/interviews" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.interviews}</span>
            </Link>
          </div>
        </div>

        {/* Pool Breakdown */}
        {candidateKpis.data && candidateKpis.data.byPool.length > 0 && (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-6">
            <h3 className="text-sm font-semibold text-[#1F114C] mb-4">{t.candidates.colPool}</h3>
            <div className="grid grid-cols-5 gap-3">
              {candidateKpis.data.byPool.map((pool) => (
                <div key={pool.poolType} className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-[#1F114C]">{pool.count}</p>
                  <p className="text-[10px] text-[#8B8B8B]">{pool.poolType}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LeaderDashboard() {
  const { t } = useI18n();
  const vacancyKpis = trpc.vacancy.getDashboardKpis.useQuery();

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.commandCenter}</h1>

        <div className="grid grid-cols-3 gap-4 mb-6">
          {vacancyKpis.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={t.vacancies.kpiOpen}
                value={vacancyKpis.data?.totalOpen ?? 0}
                subtitle={t.vacancies.activeVacancies}
                icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>}
                iconBg="bg-green-50"
              />
              <KpiCard
                label={t.vacancies.kpiPending}
                value={vacancyKpis.data?.totalPendingApproval ?? 0}
                subtitle={t.vacancies.awaitingReview}
                icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>}
                iconBg="bg-amber-50"
                highlight={(vacancyKpis.data?.totalPendingApproval ?? 0) > 0}
              />
              <KpiCard
                label={t.vacancies.kpiApplications}
                value={vacancyKpis.data?.totalApplications ?? 0}
                subtitle={t.vacancies.thisMonth}
                icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
                iconBg="bg-blue-50"
              />
            </>
          )}
        </div>

        {/* Quick Actions for Leaders */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-sm font-semibold text-[#1F114C] mb-4">{t.common.actions}</h3>
          <div className="grid grid-cols-3 gap-3">
            <Link href="/recruitment/vacancies" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.vacancies}</span>
            </Link>
            <Link href="/recruitment/interviews" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.interviews}</span>
            </Link>
            <Link href="/people/performance" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.performance}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmployeeDashboard() {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.commandCenter}</h1>

        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-6">
          <h3 className="text-sm font-semibold text-[#1F114C] mb-4">{t.common.actions}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/people/performance" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.performance}</span>
            </Link>
            <Link href="/people/onboarding" className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition">
              <svg className="w-6 h-6 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41" /></svg>
              <span className="text-xs font-medium text-[#333]">{t.sidebar.onboarding}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
