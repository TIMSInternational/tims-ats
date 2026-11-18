'use client';

import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import { useI18n, pluralize } from '../../../../lib/i18n';
import { formatNumber } from '../../../../lib/format-utils';

interface TeamIntelKpisProps {
  data:
    | {
        totalTeams: number;
        totalMembers: number;
        avgTeamSize: number;
        teamsWithoutLeader: number;
        avgTenureYears: number;
        diversityIndex: number;
      }
    | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

const GRID = 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5';

/** Organisation-wide team KPIs. Figures not computed yet show "—" with a reason, never a placeholder number. */
export function TeamIntelKpis({ data, loading, error, onRetry }: TeamIntelKpisProps) {
  const { t, locale } = useI18n();

  if (loading) {
    return (
      <div className={GRID} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4 rounded-xl border border-border bg-white shadow-card">
        <ErrorState size="compact" error={error} onRetry={onRetry} />
      </div>
    );
  }

  const members = data?.totalMembers ?? 0;
  const tenure = data?.avgTenureYears ?? 0;
  const diversity = data?.diversityIndex ?? 0;

  return (
    <div className={GRID}>
      <KpiCard
        label={t.teamIntel.kpiTeamSize}
        value={formatNumber(members, locale)}
        subtitle={pluralize(members, t.teamIntel.activeMembersForms, locale)}
      />
      <KpiCard
        label={t.teamIntel.kpiAvgTenure}
        value={formatNumber(tenure, locale, { maximumFractionDigits: 1 })}
        subtitle={t.teamIntel.years}
      />
      <KpiCard label={t.teamIntel.kpiPcaBalance} value="—" unavailableReason={t.teamIntel.noDataYet} />
      <KpiCard
        label={t.teamIntel.kpiDiversity}
        value={formatNumber(diversity, locale, { maximumFractionDigits: 2 })}
        subtitle={t.teamIntel.diversityRoles}
      />
      <KpiCard label={t.teamIntel.kpiAvgPerformance} value="—" unavailableReason={t.teamIntel.noDataYet} />
    </div>
  );
}
