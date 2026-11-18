'use client';

import { useI18n } from '../../../lib/i18n';
import { ErrorState, KpiCardSkeleton, ProgressBar, StatusBadge } from '../../../components';
import { isForbiddenError } from '../../../lib/forbidden-error';
import { formatCurrency } from '../../../lib/format-utils';

interface CompKpisProps {
  data: {
    // min-5 suppression (round 6): payroll/avgSalary/compensatedEmployees are nulled
    // when the compensated population is 1..4; avgCompaRatio when the compaRatio
    // population is <5. Render a mask ('N/D') for null values.
    totalMonthlyPayroll: number | null;
    avgSalary: number | null;
    currency?: string;
    activeEmployees: number;
    compensatedEmployees: number | null;
    // pendingAdjustments is min-5 floored (round 7): null when 1..4 pending. Mask it.
    pendingAdjustments: number | null;
    benefitsUtilizationPct: number;
    avgCompaRatio: number | null;
  } | null;
  loading: boolean;
  isError?: boolean;
  /** The query's error: a permission denial hides the strip instead of offering a retry. */
  error?: unknown;
  onRetry?: () => void;
}

// Five tiles: two per row on phones (the last spans the row), three on tablets, five on desktop.
const GRID =
  'grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1';
const TILE = 'rounded-xl border border-border bg-white p-4 shadow-card';
const LABEL = 'mb-1 text-callout font-medium text-secondary';
const VALUE = 'font-display text-title font-semibold leading-none tabular-nums text-primary md:text-display';

function Skeletons() {
  return (
    <div className={GRID} aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function CompKpis({ data, loading, isError, error, onRetry }: CompKpisProps) {
  const { t } = useI18n();

  if (loading) return <Skeletons />;

  if (isError) {
    // Leaders and employees may not read org compensation: say nothing rather than "unexpected error".
    if (isForbiddenError(error)) return null;
    return <ErrorState size="compact" error={error} onRetry={onRetry} />;
  }

  if (!data) return <Skeletons />;

  const cr = data.avgCompaRatio;
  const benefits = data.benefitsUtilizationPct;
  const currency = data.currency ?? 'USD';

  return (
    <div className={GRID}>
      <div className={TILE}>
        <div className={LABEL}>{t.compensation.kpiPayroll}</div>
        <span className={VALUE}>
          {data.totalMonthlyPayroll === null ? t.dei.na : formatCurrency(data.totalMonthlyPayroll, currency)}
        </span>
        <div className="mt-1.5 text-callout text-secondary">
          {data.compensatedEmployees === null ? t.dei.na : data.compensatedEmployees} {t.compensation.employeesShort}
        </div>
      </div>

      <div className={TILE}>
        <div className={LABEL}>{t.compensation.kpiAvgSalary}</div>
        <span className={VALUE}>{data.avgSalary === null ? t.dei.na : formatCurrency(data.avgSalary, currency)}</span>
        <div className="mt-1.5 text-callout text-secondary">
          {data.activeEmployees} {t.compensation.activeEmployeesSuffix}
        </div>
      </div>

      <div className={TILE}>
        <div className={LABEL}>{t.compensation.kpiCompaRatio}</div>
        <div className="flex flex-wrap items-end gap-2">
          <span className={VALUE}>{cr === null ? t.dei.na : cr.toFixed(2)}</span>
          {cr !== null && cr >= 0.95 && cr <= 1.05 && <StatusBadge tone="success">{t.compensation.inRange}</StatusBadge>}
        </div>
        {cr !== null && (
          <ProgressBar value={Math.min(cr * 100, 100)} label={t.compensation.kpiCompaRatio} hideLabel className="mt-2" />
        )}
      </div>

      <div className={TILE}>
        <div className={LABEL}>{t.compensation.kpiBenefitsUtil}</div>
        <span className={VALUE}>{benefits}%</span>
        <ProgressBar value={Math.min(benefits, 100)} label={t.compensation.kpiBenefitsUtil} hideLabel className="mt-2" />
      </div>

      <div className={TILE}>
        <div className={LABEL}>{t.compensation.kpiPending}</div>
        <span className={VALUE}>{data.pendingAdjustments === null ? t.dei.na : data.pendingAdjustments}</span>
      </div>
    </div>
  );
}
