'use client';

import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';

interface MonitoringKpisProps {
  data: {
    totalEmployees: number;
    activeVacancies: number;
    pendingAdjustments: number | null;
    activeSurveys: number;
    openAlerts: number;
  } | null;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5';

function KpiSkeleton() {
  return (
    <div className="rounded-xl bg-white p-4 shadow-card" aria-hidden="true">
      <div className="h-14 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
    </div>
  );
}

export function MonitoringKpis({ data, loading, isError, onRetry }: MonitoringKpisProps) {
  const { t } = useI18n();

  if (loading || (!data && !isError)) {
    return (
      <div className={GRID} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl bg-white shadow-card">
        <ErrorState size="compact" title={t.monitoring.kpisErr} onRetry={onRetry} />
      </div>
    );
  }

  // pendingAdjustments is null when k-anonymity-suppressed (sub-floor 1..4 count over
  // the restricted SalaryAdjustment population) — render a mask glyph, neutral color.
  const pendingValue = data.pendingAdjustments === null ? '—' : data.pendingAdjustments;
  // Status colour only for status figures, and only when there is something to act on.
  const items = [
    { label: t.monitoring.kpiHeadcount, value: data.totalEmployees, color: 'text-primary' },
    { label: t.monitoring.kpiVacancies, value: data.activeVacancies, color: 'text-primary' },
    {
      label: t.monitoring.kpiAlerts,
      value: data.openAlerts,
      color: data.openAlerts > 0 ? 'text-danger' : 'text-primary',
    },
    {
      label: t.monitoring.kpiPending,
      value: pendingValue,
      color: (data.pendingAdjustments ?? 0) > 0 ? 'text-warning' : 'text-primary',
    },
    { label: t.monitoring.kpiSurveys, value: data.activeSurveys, color: 'text-primary' },
  ];

  return (
    <dl className={GRID}>
      {items.map((k) => (
        <div key={k.label} className="flex flex-col-reverse rounded-xl bg-white p-4 text-center shadow-card">
          <dt className="mt-0.5 text-callout text-secondary">{k.label}</dt>
          <dd className={`font-display text-title font-bold tabular-nums md:text-display ${k.color}`}>{k.value}</dd>
        </div>
      ))}
    </dl>
  );
}
