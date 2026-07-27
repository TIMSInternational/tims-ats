'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { useReportingFunnel } from '../../../lib/platform-api/reporting';
import { useEngagementEnps, useEngagementDashboardKpis } from '../../../lib/platform-api/engagement';
import { useDeiDashboardKpis } from '../../../lib/platform-api/dei';
import { KpiCard, KpiCardSkeleton } from '../../../components';
import { suppressedValue, PLACEHOLDER } from '../../../lib/dashboard/suppress';
import { LoadError } from './load-error';
import { OrgFunnel } from './org-funnel';
import { PerformancePanel } from './performance-panel';
import { CulturePulse } from './culture-pulse';

// CARD_DOT_COLORS / CARD_BG_COLORS / Dot mirror org-command-center.tsx verbatim —
// kept local (not extracted) to match that precedent; do NOT refactor it here.
const CARD_DOT_COLORS = ['bg-blue-400', 'bg-green-400', 'bg-purple-400', 'bg-teal-400', 'bg-indigo-400', 'bg-red-400'];

const CARD_BG_COLORS = ['bg-blue-50', 'bg-green-50', 'bg-purple-50', 'bg-teal-50', 'bg-indigo-50', 'bg-red-50'];

function Dot({ index }: { index: number }) {
  return (
    <span className={`w-2.5 h-2.5 rounded-full inline-block ${CARD_DOT_COLORS[index % CARD_DOT_COLORS.length]}`} />
  );
}

export function HrExecDashboard() {
  const { t } = useI18n();
  const hr = t.hrExecDashboard;

  // hr_admin is ORGANIZATION-scoped, so every org-rollup aggregate (incl. the
  // requireOrgScope comp/DEI endpoints) is callable.
  const exec = trpc.monitoring.getExecutiveKpis.useQuery();
  const perf = trpc.performance.getDashboardKpis.useQuery();
  const enps = useEngagementEnps();
  const culture = useEngagementDashboardKpis();
  const funnel = useReportingFunnel();
  const comp = trpc.compensation.getDashboardKpis.useQuery();
  const dei = useDeiDashboardKpis();

  const kpisLoading = exec.isLoading || perf.isLoading || enps.isLoading || comp.isLoading || dei.isLoading;
  const kpisError = exec.isError || perf.isError || enps.isError || comp.isError || dei.isError;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{hr.title}</h1>
          <span className="text-[13px] text-[#585858]">{hr.subtitle}</span>
        </div>

        {/* People-first KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {kpisError ? (
            <div className="col-span-full">
              <LoadError message={hr.loadError} />
            </div>
          ) : kpisLoading ? (
            Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label={hr.headcount}
                value={exec.data?.totalEmployees ?? 0}
                subtitle={hr.activeEmployees}
                icon={<Dot index={0} />}
                iconBg={CARD_BG_COLORS[0]}
              />
              <KpiCard
                label={hr.openReqs}
                value={exec.data?.activeVacancies ?? 0}
                icon={<Dot index={1} />}
                iconBg={CARD_BG_COLORS[1]}
              />
              <KpiCard
                label={hr.activeOkrs}
                value={perf.data?.activeOkrs ?? 0}
                subtitle={`${perf.data?.averageOkrProgress ?? 0}% ${hr.avgProgress}`}
                icon={<Dot index={2} />}
                iconBg={CARD_BG_COLORS[2]}
              />
              {/* eNPS — k-anon-sensitive: suppressed flag from getEnps. */}
              <KpiCard
                label={hr.enps}
                value={suppressedValue(enps.data?.enps, enps.data?.suppressed ?? false, t.common.notDisclosed)}
                icon={<Dot index={3} />}
                iconBg={CARD_BG_COLORS[3]}
              />
              {/* Monthly Payroll — k-anon-sensitive: compensatedSuppressed flag. */}
              <KpiCard
                label={hr.monthlyPayroll}
                value={suppressedValue(
                  comp.data?.totalMonthlyPayroll,
                  comp.data?.compensatedSuppressed ?? false,
                  t.common.notDisclosed,
                )}
                icon={<Dot index={4} />}
                iconBg={CARD_BG_COLORS[4]}
              />
              {/* Diversity — DEI headline = leadershipWomenPct. dei.getDashboardKpis
                  returns this as a PERCENTAGE that is already `null` when ANY
                  leader-gender group is below the min-5 floor (dei.service.ts
                  anyLeaderGenderSuppressed). It is never a raw 1..4 head-count.
                  Routed through suppressedValue with suppressed=false so the
                  null-when-suppressed case renders the em-dash placeholder — a
                  sub-floor demographic value can never reach the DOM. */}
              <KpiCard
                label={hr.diversity}
                value={suppressedValue(dei.data?.leadershipWomenPct, false, t.common.notDisclosed)}
                subtitle={dei.data?.leadershipWomenPct == null ? PLACEHOLDER : `${dei.data.leadershipWomenPct}%`}
                icon={<Dot index={5} />}
                iconBg={CARD_BG_COLORS[5]}
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

        {/* Compensation — benefitsUtilizationPct is a plan-ratio mean (not a
            head-count, no min-5 needed); avgCompaRatio is already `null` when its
            contributing population is sub-floor, so a null-guard placeholder is the
            correct (and safe) render — no raw sub-floor value reaches the DOM. */}
        <div className="w-full bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] mb-6">
          <span className="text-base font-semibold text-[#1F114C]">{hr.compTitle}</span>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {comp.isError ? (
              <div className="md:col-span-2">
                <LoadError message={hr.loadError} />
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

function CompTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#F6F6F6] p-4">
      <div className="text-xl font-bold text-[#1F114C]">{value}</div>
      <div className="text-xs text-[#8B8B8B] mt-1">{label}</div>
    </div>
  );
}
