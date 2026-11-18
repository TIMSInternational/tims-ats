'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { useReportingFunnel } from '../../../lib/platform-api/reporting';
import { useEngagementEnps, useEngagementDashboardKpis } from '../../../lib/platform-api/engagement';
import { useMonitoringExecutiveKpis } from '../../../lib/platform-api/monitoring';
import { KpiCard, KpiCardSkeleton } from '../../../components';
import { suppressedValue } from '../../../lib/dashboard/suppress';
import { LoadError } from './load-error';
import { OrgFunnel } from './org-funnel';
import { PerformancePanel } from './performance-panel';
import { CulturePulse } from './culture-pulse';
import { DashboardPage } from './dashboard-page';

export function OrgCommandCenter() {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;

  const exec = useMonitoringExecutiveKpis();
  const perf = trpc.performance.getDashboardKpis.useQuery();
  const funnel = useReportingFunnel();
  const enps = useEngagementEnps();
  const culture = useEngagementDashboardKpis();

  const kpisLoading = exec.isLoading || perf.isLoading || enps.isLoading;
  const kpisError = exec.isError || perf.isError || enps.isError;

  return (
    <DashboardPage title={occ.title} description={occ.subtitle}>
      {/* Org-health KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {kpisError ? (
          <div className="col-span-full">
            <LoadError
              message={occ.loadError}
              onRetry={() => {
                if (exec.isError) exec.refetch();
                if (perf.isError) perf.refetch();
                if (enps.isError) enps.refetch();
              }}
            />
          </div>
        ) : kpisLoading ? (
          Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard label={occ.headcount} value={exec.data?.totalEmployees ?? 0} subtitle={occ.activeEmployees} />
            <KpiCard label={occ.openVacancies} value={exec.data?.activeVacancies ?? 0} />
            <KpiCard
              label={occ.activeOkrs}
              value={perf.data?.activeOkrs ?? 0}
              subtitle={`${perf.data?.averageOkrProgress ?? 0}% ${occ.avgProgress}`}
            />
            <KpiCard
              label={occ.enps}
              value={suppressedValue(enps.data?.enps, enps.data?.suppressed ?? false, t.common.notDisclosed)}
            />
            <KpiCard label={occ.activeSurveys} value={exec.data?.activeSurveys ?? 0} />
            <KpiCard
              label={occ.openAlerts}
              value={exec.data?.openAlerts ?? 0}
              tone="danger"
              highlight={(exec.data?.openAlerts ?? 0) > 0}
            />
          </>
        )}
      </div>

      {/* Funnel + Performance */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <OrgFunnel
          stages={funnel.data?.stages}
          conversionPct={funnel.data?.conversionPct ?? null}
          totalHired={funnel.data?.totalHired ?? 0}
          isLoading={funnel.isLoading}
          error={funnel.isError}
          onRetry={() => funnel.refetch()}
        />
        <PerformancePanel
          scheduledSessions={perf.data?.scheduledSessions ?? 0}
          completedSessions={perf.data?.completedSessions ?? 0}
          commitmentCompletionRate={perf.data?.commitmentCompletionRate ?? 0}
          activeOkrs={perf.data?.activeOkrs ?? 0}
          isLoading={perf.isLoading}
          error={perf.isError}
          onRetry={() => perf.refetch()}
        />
      </div>

      {/* Culture pulse */}
      <CulturePulse
        totalResponses={suppressedValue(
          culture.data?.totalResponses,
          culture.data?.totalResponsesSuppressed ?? false,
          t.common.notDisclosed,
        )}
        highRiskCount={culture.data?.highRiskCount ?? 0}
        actionPlansOpen={culture.data?.actionPlansOpen ?? 0}
        isLoading={culture.isLoading}
        error={culture.isError}
        onRetry={() => culture.refetch()}
      />
    </DashboardPage>
  );
}
