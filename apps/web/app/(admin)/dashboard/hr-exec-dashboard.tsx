'use client';

import { useId } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { useReportingFunnel } from '../../../lib/platform-api/reporting';
import { useEngagementEnps, useEngagementDashboardKpis } from '../../../lib/platform-api/engagement';
import { useDeiDashboardKpis } from '../../../lib/platform-api/dei';
import { useCompensationDashboardKpis } from '../../../lib/platform-api/compensation';
import { useMonitoringExecutiveKpis } from '../../../lib/platform-api/monitoring';
import { KpiCard, KpiCardSkeleton } from '../../../components';
import { suppressedValue, PLACEHOLDER } from '../../../lib/dashboard/suppress';
import { LoadError } from './load-error';
import { OrgFunnel } from './org-funnel';
import { PerformancePanel } from './performance-panel';
import { CulturePulse } from './culture-pulse';
import { DashboardPage } from './dashboard-page';

export function HrExecDashboard() {
  const { t } = useI18n();
  const hr = t.hrExecDashboard;

  // hr_admin is ORGANIZATION-scoped, so every org-rollup aggregate (incl. the
  // requireOrgScope comp/DEI endpoints) is callable.
  const exec = useMonitoringExecutiveKpis();
  const perf = trpc.performance.getDashboardKpis.useQuery();
  const enps = useEngagementEnps();
  const culture = useEngagementDashboardKpis();
  const funnel = useReportingFunnel();
  const comp = useCompensationDashboardKpis();
  const dei = useDeiDashboardKpis();

  const kpisLoading = exec.isLoading || perf.isLoading || enps.isLoading || comp.isLoading || dei.isLoading;
  const kpisError = exec.isError || perf.isError || enps.isError || comp.isError || dei.isError;
  const compTitleId = useId();
  const retryKpis = () => {
    for (const q of [exec, perf, enps, comp, dei]) if (q.isError) q.refetch();
  };

  return (
    <DashboardPage title={hr.title} description={hr.subtitle}>
      {/* People-first KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {kpisError ? (
          <div className="col-span-full">
            <LoadError message={hr.loadError} onRetry={retryKpis} />
          </div>
        ) : kpisLoading ? (
          Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard label={hr.headcount} value={exec.data?.totalEmployees ?? 0} subtitle={hr.activeEmployees} />
            <KpiCard label={hr.openReqs} value={exec.data?.activeVacancies ?? 0} />
            <KpiCard
              label={hr.activeOkrs}
              value={perf.data?.activeOkrs ?? 0}
              subtitle={`${perf.data?.averageOkrProgress ?? 0}% ${hr.avgProgress}`}
            />
            {/* eNPS — k-anon-sensitive: suppressed flag from getEnps. */}
            <KpiCard
              label={hr.enps}
              value={suppressedValue(enps.data?.enps, enps.data?.suppressed ?? false, t.common.notDisclosed)}
            />
            {/* Monthly Payroll — k-anon-sensitive: compensatedSuppressed flag. */}
            <KpiCard
              label={hr.monthlyPayroll}
              value={suppressedValue(
                comp.data?.totalMonthlyPayroll,
                comp.data?.compensatedSuppressed ?? false,
                t.common.notDisclosed,
              )}
            />
            {/* Diversity — DEI headline = leadershipWomenPct. useDeiDashboardKpis (C#-only
                  since the 2026-07-31 TS deletion — see lib/platform-api/dei.ts) returns this
                  as a PERCENTAGE that is already `null` when ANY leader-gender group is below
                  the min-5 floor (the same anyLeaderGenderSuppressed guard, now applied
                  server-side by the C# port of the @tims/shared deiDashboardKpis kernel — see
                  packages/shared/src/dei.ts, golden-fixtured against Tims.Domain.Dei.DeiKernels).
                  It is never a raw 1..4 head-count. Routed through suppressedValue with
                  suppressed=false so the null-when-suppressed case renders the em-dash
                  placeholder — a sub-floor demographic value can never reach the DOM. */}
            <KpiCard
              label={hr.diversity}
              value={
                dei.data?.leadershipWomenPct == null
                  ? suppressedValue(dei.data?.leadershipWomenPct, false, t.common.notDisclosed)
                  : `${dei.data.leadershipWomenPct}%`
              }
              subtitle={hr.diversityHint}
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

      {/* Compensation — benefitsUtilizationPct is a plan-ratio mean (not a
            head-count, no min-5 needed); avgCompaRatio is already `null` when its
            contributing population is sub-floor, so a null-guard placeholder is the
            correct (and safe) render — no raw sub-floor value reaches the DOM. */}
      <section aria-labelledby={compTitleId} className="mb-6 w-full rounded-xl bg-white p-5 shadow-card">
        <h2 id={compTitleId} className="text-heading font-semibold text-brand">
          {hr.compTitle}
        </h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {comp.isError ? (
            <div className="md:col-span-2">
              <LoadError message={hr.loadError} onRetry={() => comp.refetch()} />
            </div>
          ) : comp.isLoading ? (
            Array.from({ length: 2 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <CompTile label={hr.benefitsUtilization} value={`${comp.data?.benefitsUtilizationPct ?? 0}%`} />
              <CompTile
                label={hr.avgCompaRatio}
                value={comp.data?.avgCompaRatio == null ? PLACEHOLDER : String(comp.data.avgCompaRatio)}
              />
            </>
          )}
        </div>
      </section>

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

function CompTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface p-4">
      <div className="font-display text-title font-bold tabular-nums text-primary">{value}</div>
      <div className="mt-1 text-callout text-secondary">{label}</div>
    </div>
  );
}
