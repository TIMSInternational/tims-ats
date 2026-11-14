'use client';

import { useId, useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';
import { RecruitingKpiStrip } from './recruiting-kpi-strip';
import { PipelineFunnel, PipelineFunnelSkeleton } from './pipeline-funnel';
import { OpenVacanciesCard, OpenVacanciesCardSkeleton } from './open-vacancies-card';
import { AlertsSlaPanel } from './alerts-sla-panel';
import { AlertsPendingPanel } from './alerts-pending-panel';
import { AlertsRiskPanel } from './alerts-risk-panel';
import { AlertsVacancySelect } from './alerts-vacancy-select';
import { RecruiterQuickActions } from './recruiter-quick-actions';
import { pickPrimaryDashboard, showsSetupChecklistFor } from './pick-dashboard';
import { SetupChecklist } from './setup-checklist';
import { OrgCommandCenter } from './org-command-center';
import { HrExecDashboard } from './hr-exec-dashboard';
import { UnitHealthDashboard } from './unit-health-dashboard';
import { ManagerDashboard } from './manager-dashboard';
import { CommitteeTasksDashboard } from './committee-tasks-dashboard';
import { EmployeeHomeDashboard } from './employee-home-dashboard';
import { UnassignedDashboard } from './unassigned-dashboard';
import { readLaunchScope } from '../../../lib/launch-scope';
import { buildFunnelVacancies } from './funnel-vacancies';
import { MyApprovalsCard } from './my-approvals-card';
import { DashboardLeadContext, DashboardPage } from './dashboard-page';

interface RecruitmentDashboardProps {
  roleSlugs: string[];
}

export function RecruitmentDashboard({ roleSlugs }: RecruitmentDashboardProps) {
  const scope = readLaunchScope();
  const key = pickPrimaryDashboard(roleSlugs, scope);
  // Pilot launch scope: the role dashboards that survive (leader, committee, employee) render only their
  // recruitment / onboarding sections; the out-of-scope sections are not mounted, so their queries never run.
  const isPilot = scope === 'pilot';
  // Setup Checklist widget: super_admin/hr_admin only per the Task 4 brief. Keyed to the ROLE, not the
  // dashboard key, because the pilot launch scope lands both roles on the Recruiter dashboard.
  const showsSetupChecklist = showsSetupChecklistFor(roleSlugs);

  const dashboard = (() => {
    switch (key) {
      case 'org':
        return <OrgCommandCenter />;
      case 'hrExec':
        return <HrExecDashboard />;
      case 'unit':
        return <UnitHealthDashboard />;
      case 'recruiter':
        return <RecruiterDashboard />;
      case 'manager':
        return <ManagerDashboard isPilot={isPilot} />;
      case 'committee':
        return <CommitteeTasksDashboard isPilot={isPilot} />;
      case 'employee':
        return <EmployeeHomeDashboard isPilot={isPilot} />;
      case 'unassigned':
        return <UnassignedDashboard />;
      default: {
        // Exhaustiveness guard: if DashboardKey grows without a case here, this
        // line becomes a compile error instead of a silent fallthrough.
        const _exhaustive: never = key;
        return <EmployeeHomeDashboard isPilot={isPilot} />;
      }
    }
  })();

  // The setup checklist opens the chosen dashboard's body, under its page header (DashboardPage reads it),
  // instead of sitting above the h1 outside the scroll container.
  return (
    <DashboardLeadContext.Provider value={showsSetupChecklist ? <SetupChecklist /> : null}>
      {dashboard}
    </DashboardLeadContext.Provider>
  );
}

function RecruiterDashboard() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  const vacancyKpis = trpc.vacancy.getDashboardKpis.useQuery();
  const candidateKpis = trpc.candidate.getDashboardKpis.useQuery();
  const publishedVacancies = trpc.vacancy.list.useQuery({ limit: 50, status: 'published' }, { staleTime: 60_000 });
  // Recently filled vacancies stay in the funnel selector (see funnel-vacancies.ts).
  const closedVacancies = trpc.vacancy.list.useQuery(
    { limit: 10, status: 'closed', orderBy: 'closed' },
    { staleTime: 60_000 },
  );
  const funnelVacancies = buildFunnelVacancies(
    publishedVacancies.data?.items ?? [],
    closedVacancies.data?.items ?? [],
    rd.closedVacancyTag,
  );

  const isLoading = vacancyKpis.isLoading || candidateKpis.isLoading;
  const kpiIsError = vacancyKpis.isError || candidateKpis.isError;
  // The SLA and risk panels read one vacancy's board: the one picked in the alerts header (default: the
  // first published vacancy), named there so the scope is never silent.
  const [pickedAlertsVacancyId, setPickedAlertsVacancyId] = useState<string | null>(null);
  const alertVacancies = publishedVacancies.data?.items ?? [];
  const alertsVacancyId = (alertVacancies.find((v) => v.id === pickedAlertsVacancyId) ?? alertVacancies[0])?.id;
  const alertsTitleId = useId();

  return (
    <DashboardPage title={rd.overviewMetrics} description={rd.todaysStatus} actions={<RecruiterQuickActions />}>
      <MyApprovalsCard className="mb-6" />

      {/* KPI Cards Strip */}
      <RecruitingKpiStrip
        vacancyKpis={vacancyKpis.data}
        candidateKpis={candidateKpis.data}
        isLoading={isLoading}
        isError={kpiIsError}
        onRetry={() => {
          vacancyKpis.refetch();
          candidateKpis.refetch();
        }}
      />

      {/* Pipeline + open vacancies */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        {/* The funnel's vacancy list must have loaded too, or an empty list would read as "none published". */}
        {isLoading || publishedVacancies.isLoading || closedVacancies.isLoading ? (
          <>
            <PipelineFunnelSkeleton />
            <OpenVacanciesCardSkeleton />
          </>
        ) : publishedVacancies.isError || closedVacancies.isError ? (
          <ErrorState
            size="compact"
            className="w-full rounded-xl bg-white shadow-card"
            onRetry={() => {
              if (publishedVacancies.isError) publishedVacancies.refetch();
              if (closedVacancies.isError) closedVacancies.refetch();
            }}
          />
        ) : (
          <>
            <PipelineFunnel vacancies={funnelVacancies} />
            {/* Only the real count: a failed KPI query shows an error, never a default 0. */}
            {vacancyKpis.data && !vacancyKpis.isError ? (
              <OpenVacanciesCard totalOpen={vacancyKpis.data.totalOpen} />
            ) : (
              <ErrorState
                size="compact"
                className="w-full rounded-xl bg-white shadow-card md:flex-[35]"
                onRetry={() => vacancyKpis.refetch()}
                error={vacancyKpis.error}
              />
            )}
          </>
        )}
      </div>

      <section aria-labelledby={alertsTitleId}>
        {/* Alerts Section Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id={alertsTitleId} className="text-heading font-semibold text-brand">
              {rd.alertsTitle}
            </h2>
            <p className="text-callout text-secondary">
              {alertVacancies.length > 0 ? rd.alertsScopeHint : rd.alertsSubtitle}
            </p>
          </div>
          <AlertsVacancySelect
            vacancies={alertVacancies}
            selectedId={alertsVacancyId}
            onSelect={setPickedAlertsVacancyId}
          />
        </div>

        {/* 3-Column Alerts */}
        <div className="flex flex-col gap-4 md:flex-row">
          <AlertsSlaPanel vacancyId={alertsVacancyId} vacanciesLoading={publishedVacancies.isLoading} />
          <AlertsPendingPanel />
          <AlertsRiskPanel vacancyId={alertsVacancyId} vacanciesLoading={publishedVacancies.isLoading} />
        </div>
      </section>
    </DashboardPage>
  );
}
