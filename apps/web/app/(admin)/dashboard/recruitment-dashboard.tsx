'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';
import { RecruitingKpiStrip } from './recruiting-kpi-strip';
import { PipelineFunnel, PipelineFunnelSkeleton } from './pipeline-funnel';
import { OpenVacanciesCard, OpenVacanciesCardSkeleton } from './open-vacancies-card';
import { AlertsSlaPanel } from './alerts-sla-panel';
import { AlertsPendingPanel } from './alerts-pending-panel';
import { AlertsRiskPanel } from './alerts-risk-panel';
import { pickPrimaryDashboard } from './pick-dashboard';
import { SetupChecklist } from './setup-checklist';
import { OrgCommandCenter } from './org-command-center';
import { HrExecDashboard } from './hr-exec-dashboard';
import { UnitHealthDashboard } from './unit-health-dashboard';
import { ManagerDashboard } from './manager-dashboard';
import { CommitteeTasksDashboard } from './committee-tasks-dashboard';
import { EmployeeHomeDashboard } from './employee-home-dashboard';
import { UnassignedDashboard } from './unassigned-dashboard';

interface RecruitmentDashboardProps {
  roleSlugs: string[];
}

export function RecruitmentDashboard({ roleSlugs }: RecruitmentDashboardProps) {
  const key = pickPrimaryDashboard(roleSlugs);
  // Setup Checklist widget: 'org' and 'hrExec' are exclusively the
  // super_admin and hr_admin landings respectively (see pick-dashboard.ts's
  // precedence order — super_admin always wins the 'org' key over hr_admin,
  // and no other role maps to either key), so this correctly gates the
  // widget to super_admin/hr_admin only per the Task 4 brief.
  const showsSetupChecklist = key === 'org' || key === 'hrExec';

  const dashboard = (() => {
    switch (key) {
      case 'org': return <OrgCommandCenter />;
      case 'hrExec': return <HrExecDashboard />;
      case 'unit': return <UnitHealthDashboard />;
      case 'recruiter': return <RecruiterDashboard />;
      case 'manager': return <ManagerDashboard />;
      case 'committee': return <CommitteeTasksDashboard />;
      case 'employee': return <EmployeeHomeDashboard />;
      case 'unassigned': return <UnassignedDashboard />;
      default: {
        // Exhaustiveness guard: if DashboardKey grows without a case here, this
        // line becomes a compile error instead of a silent fallthrough.
        const _exhaustive: never = key;
        return <EmployeeHomeDashboard />;
      }
    }
  })();

  // Wrap in a flex column so SetupChecklist (natural height) and the chosen
  // dashboard (remaining space) share the viewport instead of both claiming
  // h-full as independent siblings of admin-shell's plain (non-flex) scroll
  // container — every dashboard case's own root already assumes it's the
  // SOLE h-full child of that container (h-full flex flex-col overflow-hidden
  // + its own internal flex-1 min-h-0 overflow-y-auto), so this wrapper gives
  // it that same guarantee one level deeper rather than changing any
  // dashboard component itself. Safe for all 7 cases, not just the 2 that
  // show the checklist: the inner flex-1 min-h-0 overflow-hidden div always
  // has a real computed height to hand down, whether or not SetupChecklist
  // is present above it.
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {showsSetupChecklist && <SetupChecklist />}
      <div className="flex-1 min-h-0 overflow-hidden">{dashboard}</div>
    </div>
  );
}

function RecruiterDashboard() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  const vacancyKpis = trpc.vacancy.getDashboardKpis.useQuery();
  const candidateKpis = trpc.candidate.getDashboardKpis.useQuery();
  const publishedVacancies = trpc.vacancy.list.useQuery(
    { limit: 50, status: 'published' },
    { staleTime: 60_000 },
  );

  const isLoading = vacancyKpis.isLoading || candidateKpis.isLoading;
  const kpiIsError = vacancyKpis.isError || candidateKpis.isError;
  const firstVacancyId = publishedVacancies.data?.items?.[0]?.id;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{rd.overviewMetrics}</h1>
          <span className="text-[13px] text-[#585858]">{rd.todaysStatus}</span>
        </div>

        {/* KPI Cards Strip */}
        <RecruitingKpiStrip
          vacancyKpis={vacancyKpis.data}
          candidateKpis={candidateKpis.data}
          isLoading={isLoading}
          isError={kpiIsError}
          onRetry={() => { vacancyKpis.refetch(); candidateKpis.refetch(); }}
        />

        {/* Pipeline + open vacancies */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          {/* The funnel's vacancy list must have loaded too, or an empty list would read as "none published". */}
          {isLoading || publishedVacancies.isLoading ? (
            <>
              <PipelineFunnelSkeleton />
              <OpenVacanciesCardSkeleton />
            </>
          ) : publishedVacancies.isError ? (
            <ErrorState onRetry={() => publishedVacancies.refetch()} />
          ) : (
            <>
              <PipelineFunnel vacancies={publishedVacancies.data?.items ?? []} />
              {/* Only the real count: a failed KPI query shows an error, never a default 0. */}
              {vacancyKpis.data && !vacancyKpis.isError ? (
                <OpenVacanciesCard totalOpen={vacancyKpis.data.totalOpen} />
              ) : (
                <ErrorState onRetry={() => vacancyKpis.refetch()} />
              )}
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
          <AlertsSlaPanel vacancyId={firstVacancyId} vacanciesLoading={publishedVacancies.isLoading} />
          <AlertsPendingPanel />
          <AlertsRiskPanel vacancyId={firstVacancyId} vacanciesLoading={publishedVacancies.isLoading} />
        </div>
      </div>
    </div>
  );
}
