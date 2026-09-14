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

const CARD_DOT_COLORS = ['bg-blue-400', 'bg-green-400', 'bg-purple-400', 'bg-teal-400', 'bg-indigo-400', 'bg-red-400'];

const CARD_BG_COLORS = ['bg-blue-50', 'bg-green-50', 'bg-purple-50', 'bg-teal-50', 'bg-indigo-50', 'bg-red-50'];

function Dot({ index }: { index: number }) {
  return (
    <span className={`w-2.5 h-2.5 rounded-full inline-block ${CARD_DOT_COLORS[index % CARD_DOT_COLORS.length]}`} />
  );
}

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
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{occ.title}</h1>
          <span className="text-[13px] text-[#585858]">{occ.subtitle}</span>
        </div>

        {/* Org-health KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {kpisError ? (
            <div className="col-span-full">
              <LoadError message={occ.loadError} />
            </div>
          ) : kpisLoading ? (
            Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={occ.headcount}
                value={exec.data?.totalEmployees ?? 0}
                subtitle={occ.activeEmployees}
                icon={<Dot index={0} />}
                iconBg={CARD_BG_COLORS[0]}
              />
              <KpiCard
                label={occ.openVacancies}
                value={exec.data?.activeVacancies ?? 0}
                icon={<Dot index={1} />}
                iconBg={CARD_BG_COLORS[1]}
              />
              <KpiCard
                label={occ.activeOkrs}
                value={perf.data?.activeOkrs ?? 0}
                subtitle={`${perf.data?.averageOkrProgress ?? 0}% ${occ.avgProgress}`}
                icon={<Dot index={2} />}
                iconBg={CARD_BG_COLORS[2]}
              />
              <KpiCard
                label={occ.enps}
                value={suppressedValue(enps.data?.enps, enps.data?.suppressed ?? false, t.common.notDisclosed)}
                icon={<Dot index={3} />}
                iconBg={CARD_BG_COLORS[3]}
              />
              <KpiCard
                label={occ.activeSurveys}
                value={exec.data?.activeSurveys ?? 0}
                icon={<Dot index={4} />}
                iconBg={CARD_BG_COLORS[4]}
              />
              <KpiCard
                label={occ.openAlerts}
                value={exec.data?.openAlerts ?? 0}
                icon={<Dot index={5} />}
                iconBg={CARD_BG_COLORS[5]}
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
          />
          <PerformancePanel
            scheduledSessions={perf.data?.scheduledSessions ?? 0}
            completedSessions={perf.data?.completedSessions ?? 0}
            commitmentCompletionRate={perf.data?.commitmentCompletionRate ?? 0}
            activeOkrs={perf.data?.activeOkrs ?? 0}
            isLoading={perf.isLoading}
            error={perf.isError}
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
        />
      </div>
    </div>
  );
}
