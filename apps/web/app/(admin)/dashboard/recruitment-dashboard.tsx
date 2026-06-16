'use client';

import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, EmptyState } from '../../../components';
import { RecruitingKpiStrip } from './recruiting-kpi-strip';
import { PipelineFunnel, PipelineFunnelSkeleton } from './pipeline-funnel';
import { VacanciesByDimension, VacanciesByDimensionSkeleton } from './vacancies-by-dimension';
import { AlertsSlaPanel } from './alerts-sla-panel';
import { AlertsPendingPanel } from './alerts-pending-panel';
import { AlertsRiskPanel } from './alerts-risk-panel';
import { pickPrimaryDashboard } from './pick-dashboard';
import { OrgCommandCenter } from './org-command-center';

interface RecruitmentDashboardProps {
  roleSlugs: string[];
}

export function RecruitmentDashboard({ roleSlugs }: RecruitmentDashboardProps) {
  const key = pickPrimaryDashboard(roleSlugs);
  switch (key) {
    case 'org': return <OrgCommandCenter />;
    case 'recruiter': return <RecruiterDashboard />;
    case 'leader': return <LeaderDashboard />;
    case 'employee': return <EmployeeDashboard />;
    default: {
      // Exhaustiveness guard: if DashboardKey grows (e.g. Slice 4 'participant')
      // without a case here, this line becomes a compile error instead of a
      // silent fallthrough to EmployeeDashboard.
      const _exhaustive: never = key;
      return <EmployeeDashboard />;
    }
  }
}

function RecruiterDashboard() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  const vacancyKpis = trpc.vacancy.getDashboardKpis.useQuery();
  const candidateKpis = trpc.candidate.getDashboardKpis.useQuery();

  const isLoading = vacancyKpis.isLoading || candidateKpis.isLoading;
  const totalApplications = vacancyKpis.data?.totalApplications ?? 0;
  const totalOpen = vacancyKpis.data?.totalOpen ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{rd.overviewMetrics}</h1>
          <span className="text-[13px] text-[#585858]">{rd.todaysStatus}</span>
        </div>

        {/* KPI Cards Strip */}
        <RecruitingKpiStrip />

        {/* Pipeline + Vacancies by Dimension */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          {isLoading ? (
            <>
              <PipelineFunnelSkeleton />
              <VacanciesByDimensionSkeleton />
            </>
          ) : (
            <>
              <PipelineFunnel totalApplications={totalApplications} />
              <VacanciesByDimension totalOpen={totalOpen} />
            </>
          )}
        </div>

        {/* Alerts Section Header */}
        <div className="flex justify-between items-center mb-4">
          <span className="text-base font-semibold text-[#1F114C]">{rd.alertsTitle}</span>
          <span className="text-[13px] text-[#585858]">{rd.alertsSubtitle}</span>
        </div>

        {/* 3-Column Alerts */}
        <div className="flex flex-col md:flex-row gap-4">
          <AlertsSlaPanel />
          <AlertsPendingPanel />
          <AlertsRiskPanel />
        </div>
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
        <h1 className="text-lg font-semibold text-[#1F114C] mb-5">
          {t.sidebar.commandCenter}
        </h1>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {vacancyKpis.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={t.vacancies.kpiOpen}
                value={vacancyKpis.data?.totalOpen ?? 0}
                subtitle={t.vacancies.activeVacancies}
                icon={<VacancyIcon />}
                iconBg="bg-green-50"
              />
              <KpiCard
                label={t.vacancies.kpiPending}
                value={vacancyKpis.data?.totalPendingApproval ?? 0}
                subtitle={t.vacancies.awaitingReview}
                icon={<ClockIcon />}
                iconBg="bg-amber-50"
                highlight={(vacancyKpis.data?.totalPendingApproval ?? 0) > 0}
              />
              <KpiCard
                label={t.vacancies.kpiApplications}
                value={vacancyKpis.data?.totalApplications ?? 0}
                subtitle={t.vacancies.thisMonth}
                icon={<PeopleIcon />}
                iconBg="bg-blue-50"
              />
            </>
          )}
        </div>
        <QuickActions
          links={[
            { href: '/recruitment/vacancies', label: t.sidebar.vacancies, icon: <VacancyIcon size={6} /> },
            { href: '/recruitment/interviews', label: t.sidebar.interviews, icon: <VideoIcon size={6} /> },
            { href: '/people/performance', label: t.sidebar.performance, icon: <TargetIcon size={6} /> },
          ]}
          label={t.common.actions}
          cols={3}
        />
      </div>
    </div>
  );
}

function EmployeeDashboard() {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h1 className="text-lg font-semibold text-[#1F114C] mb-5">
          {t.sidebar.commandCenter}
        </h1>
        <QuickActions
          links={[
            { href: '/people/performance', label: t.sidebar.performance, icon: <TargetIcon size={6} /> },
            { href: '/people/onboarding', label: t.sidebar.onboarding, icon: <RocketIcon size={6} /> },
          ]}
          label={t.common.actions}
          cols={2}
        />
      </div>
    </div>
  );
}

/* ---------- Shared small components ---------- */

const GRID_COLS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

interface QuickActionsProps {
  links: { href: string; label: string; icon: React.ReactNode }[];
  label: string;
  cols: number;
}

function QuickActions({ links, label, cols }: QuickActionsProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-[#1F114C] mb-4">{label}</h3>
      <div className={`grid ${GRID_COLS[cols] ?? 'grid-cols-3'} gap-3`}>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition"
          >
            {l.icon}
            <span className="text-xs font-medium text-[#333]">{l.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ---------- Icon helpers ---------- */

const ICON_SIZE: Record<number, string> = { 4: 'w-4 h-4', 6: 'w-6 h-6' };

function VacancyIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`${ICON_SIZE[size]} text-green-500`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a4 4 0 00-8 0v2" />
    </svg>
  );
}

function PeopleIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`${ICON_SIZE[size]} text-blue-500`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  );
}

function ClockIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`${ICON_SIZE[size]} text-amber-500`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function VideoIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`${ICON_SIZE[size]} text-[#1F114C]`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function TargetIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`${ICON_SIZE[size]} text-[#1F114C]`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function RocketIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`${ICON_SIZE[size]} text-[#1F114C]`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41" />
    </svg>
  );
}
