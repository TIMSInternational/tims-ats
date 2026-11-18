'use client';

import { useId } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardAiCostAnomalies } from '../../../../lib/platform-api/dashboard';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';
import { StatusBadge, type StatusTone } from '../../../../components/status-badge';

const CARD = 'flex flex-col rounded-xl border border-border bg-white p-5 shadow-card';

const TYPE_TONE: Record<string, StatusTone> = {
  zero_usage: 'warning',
  over_budget: 'danger',
  high_cost: 'info',
};

export function AiCostAnomalyPanel() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const router = useRouter();
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardAiCostAnomalies();

  const typeLabel: Record<string, string> = {
    zero_usage: d.zeroUsage,
    over_budget: d.overBudget,
    high_cost: d.highCost,
  };

  if (isLoading) {
    return (
      <div className={CARD} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="mb-2 h-4 w-44" />
        <Skeleton className="mb-4 h-3 w-56" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CARD}>
        <ErrorState size="compact" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data || data.anomalies.length === 0) {
    return (
      <section aria-labelledby={titleId} className={CARD}>
        <h2 id={titleId} className="mb-1 text-heading font-semibold text-brand">
          {d.aiCostTitle}
        </h2>
        <div className="py-6 text-center">
          <svg
            className="mx-auto mb-2 size-8 text-success"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-subheading font-semibold text-primary">{d.noAnomalies}</p>
          <p className="mt-0.5 text-callout text-secondary">{d.allOptimized}</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={CARD}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-heading font-semibold text-brand">
            {d.aiCostTitle}
          </h2>
          <p className="text-callout text-secondary">{d.aiCostSubtitle}</p>
        </div>
        {data.totalPotentialSavings > 0 && (
          <div className="text-right">
            <p className="text-title font-bold tabular-nums text-warning">
              {formatCurrency(data.totalPotentialSavings, locale)}
            </p>
            <p className="text-caption text-secondary">{d.potentialSavings}</p>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="mb-4 flex flex-wrap gap-2">
        {data.zeroUsageCount > 0 && (
          <StatusBadge tone="warning">
            {data.zeroUsageCount} {d.zeroUsage}
          </StatusBadge>
        )}
        {data.overBudgetCount > 0 && (
          <StatusBadge tone="danger">
            {data.overBudgetCount} {d.overBudget}
          </StatusBadge>
        )}
      </div>

      {/* Anomalies list */}
      <ul className="max-h-[280px] space-y-1.5 overflow-y-auto">
        {data.anomalies.slice(0, 10).map((anomaly, i) => (
          <li key={`${anomaly.agentSlug}-${anomaly.orgId}-${i}`}>
            <button
              type="button"
              onClick={() => router.push('/platform/ai-agents')}
              className="w-full rounded-lg bg-surface-hover px-4 py-2.5 text-left transition-colors hover:bg-surface"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-body font-medium text-primary">{anomaly.agentName}</span>
                    <span className="text-caption text-secondary">{anomaly.orgName}</span>
                    <StatusBadge tone={TYPE_TONE[anomaly.type] ?? 'warning'}>
                      {typeLabel[anomaly.type] ?? anomaly.type}
                    </StatusBadge>
                  </div>
                  <p className="text-callout text-secondary">{anomaly.detail}</p>
                </div>
                <span className="shrink-0 text-callout font-bold tabular-nums text-warning">
                  {formatCurrency(anomaly.potentialSavings, locale)}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
