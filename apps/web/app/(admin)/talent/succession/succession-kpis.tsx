'use client';

import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface SuccessionKpisProps {
  data:
    | {
        totalCriticalRoles: number;
        readyNowCount: number;
        ready1to2YearsCount: number;
        rolesWithoutSuccessor: number;
        highFlightRiskRoles: number;
        totalSuccessors: number;
      }
    | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

const GRID = 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5';

/** The succession KPI row on the shared KpiCard; colour only where the number is a status and non-zero. */
export function SuccessionKpis({ data, loading, error, onRetry }: SuccessionKpisProps) {
  const { t } = useI18n();

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
        <ErrorState size="compact" title={t.succession.loadError} error={error} onRetry={onRetry} />
      </div>
    );
  }

  const uncovered = data?.rolesWithoutSuccessor ?? 0;

  return (
    <div className={GRID}>
      <KpiCard
        label={t.succession.kpiCriticalRoles}
        value={data?.totalCriticalRoles ?? 0}
        subtitle={t.succession.identifiedInOrg}
      />
      <KpiCard
        label={t.succession.kpiReadyNow}
        value={data?.readyNowCount ?? 0}
        subtitle={t.succession.readyImmediately}
      />
      <KpiCard
        label={t.succession.kpi1to2Years}
        value={data?.ready1to2YearsCount ?? 0}
        subtitle={t.succession.activeDevelopment}
      />
      <KpiCard
        label={t.succession.kpiNoSuccessor}
        value={uncovered}
        subtitle={
          uncovered > 0
            ? t.succession.requiresImmediate
            : (data?.totalCriticalRoles ?? 0) > 0
              ? t.succession.allCovered
              : undefined
        }
        tone="danger"
        highlight={uncovered > 0}
      />
      <KpiCard
        label={t.succession.kpiFlightRisk}
        value={data?.highFlightRiskRoles ?? 0}
        subtitle={t.succession.keyEmployeesAtRisk}
        tone="warning"
      />
    </div>
  );
}
