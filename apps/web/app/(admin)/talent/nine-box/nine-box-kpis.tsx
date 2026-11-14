'use client';

import { KpiCard } from '../../../../components';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { formatPercent } from '../../../../lib/format-utils';

interface NineBoxKpisProps {
  total: number;
  highPotentialCount: number;
  atRiskCount: number;
  avgConfidence: number;
  period: string;
}

/** The nine-box KPI row, on the shared KpiCard (foundation-spec.md §8). */
export function NineBoxKpis({ total, highPotentialCount, atRiskCount, avgConfidence, period }: NineBoxKpisProps) {
  const { t, locale } = useI18n();
  const share = (n: number) =>
    total > 0 ? formatMessage(t.nineBox.shareOfTotal, { pct: Math.round((n / total) * 100) }) : undefined;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label={t.nineBox.kpiEvaluated}
        value={total}
        subtitle={formatMessage(t.nineBox.cycleLabel, { period })}
        icon={
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        }
      />
      <KpiCard
        label={t.nineBox.kpiHighPotential}
        value={highPotentialCount}
        subtitle={share(highPotentialCount)}
        icon={
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
        }
      />
      <KpiCard
        label={t.nineBox.kpiAtRisk}
        value={atRiskCount}
        subtitle={share(atRiskCount)}
        tone="danger"
        highlight={atRiskCount > 0}
        icon={
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            <path d="M12 15.75h.007v.008H12v-.008z" />
          </svg>
        }
      />
      <KpiCard label={t.nineBox.avgConfidence} value={formatPercent(avgConfidence, locale)} />
    </div>
  );
}
