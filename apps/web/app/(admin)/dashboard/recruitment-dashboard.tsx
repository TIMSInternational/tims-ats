'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { RecruitingKpiStrip } from './recruiting-kpi-strip';
import { PipelineFunnel, PipelineFunnelSkeleton } from './pipeline-funnel';
import { VacanciesByDimension, VacanciesByDimensionSkeleton } from './vacancies-by-dimension';
import { AlertsSlaPanel } from './alerts-sla-panel';
import { AlertsPendingPanel } from './alerts-pending-panel';
import { AlertsRiskPanel } from './alerts-risk-panel';
import { pickPrimaryDashboard } from './pick-dashboard';
import { OrgCommandCenter } from './org-command-center';
import { HrExecDashboard } from './hr-exec-dashboard';
import { UnitHealthDashboard } from './unit-health-dashboard';
import { ManagerDashboard } from './manager-dashboard';
import { CommitteeTasksDashboard } from './committee-tasks-dashboard';
import { EmployeeHomeDashboard } from './employee-home-dashboard';

interface RecruitmentDashboardProps {
  roleSlugs: string[];
}

export function RecruitmentDashboard({ roleSlugs }: RecruitmentDashboardProps) {
  const key = pickPrimaryDashboard(roleSlugs);
  switch (key) {
    case 'org': return <OrgCommandCenter />;
    case 'hrExec': return <HrExecDashboard />;
    case 'unit': return <UnitHealthDashboard />;
    case 'recruiter': return <RecruiterDashboard />;
    case 'manager': return <ManagerDashboard />;
    case 'committee': return <CommitteeTasksDashboard />;
    case 'employee': return <EmployeeHomeDashboard />;
    default: {
      // Exhaustiveness guard: if DashboardKey grows without a case here, this
      // line becomes a compile error instead of a silent fallthrough.
      const _exhaustive: never = key;
      return <EmployeeHomeDashboard />;
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
