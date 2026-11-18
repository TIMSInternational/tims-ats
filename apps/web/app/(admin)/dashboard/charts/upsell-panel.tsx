'use client';

import { useId } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardUpsellOpportunities } from '../../../../lib/platform-api/dashboard';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, PLAN_BG_CLASSES, PLAN_CHIP_FALLBACK, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';
import { StatusBadge, type StatusTone } from '../../../../components/status-badge';

const CARD = 'flex flex-col rounded-xl border border-border bg-white p-5 shadow-card';

const CONFIDENCE_TONE: Record<string, StatusTone> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
};

function PlanChip({ plan }: { plan: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-caption font-medium ${PLAN_BG_CLASSES[plan] ?? PLAN_CHIP_FALLBACK}`}>
      {PLAN_LABELS[plan] ?? plan}
    </span>
  );
}

export function UpsellPanel() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const router = useRouter();
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardUpsellOpportunities();

  const confidenceLabel: Record<string, string> = {
    high: d.highConfidence,
    medium: d.mediumConfidence,
    low: d.lowConfidence,
  };

  if (isLoading) {
    return (
      <div className={CARD} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="mb-2 h-4 w-40" />
        <Skeleton className="mb-4 h-3 w-56" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
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

  if (!data || data.opportunities.length === 0) {
    return (
      <section aria-labelledby={titleId} className={CARD}>
        <h2 id={titleId} className="mb-1 text-heading font-semibold text-brand">
          {d.upsellTitle}
        </h2>
        <p className="py-6 text-center text-body text-secondary">{d.noUpsells}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={CARD}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-heading font-semibold text-brand">
            {d.upsellTitle}
          </h2>
          <p className="text-callout text-secondary">{d.upsellSubtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-title font-bold tabular-nums text-success">
            +{formatCurrency(data.totalPotentialMrr, locale)}
          </p>
          <p className="text-caption text-secondary">{d.potentialMrr}</p>
        </div>
      </div>

      {/* Confidence summary */}
      <div className="mb-4 flex flex-wrap gap-2">
        {data.highConfidence > 0 && (
          <StatusBadge tone="success">
            {data.highConfidence} {d.highConfidence}
          </StatusBadge>
        )}
        {data.mediumConfidence > 0 && (
          <StatusBadge tone="warning">
            {data.mediumConfidence} {d.mediumConfidence}
          </StatusBadge>
        )}
      </div>

      {/* Opportunities list */}
      <ul className="max-h-[280px] space-y-1.5 overflow-y-auto">
        {data.opportunities.slice(0, 8).map((opp) => (
          <li key={opp.orgId}>
            <button
              type="button"
              onClick={() => router.push(`/platform/organizations/${opp.orgId}`)}
              className="w-full rounded-lg border border-transparent bg-surface-hover px-4 py-3 text-left transition-colors hover:border-border"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-body font-medium text-primary">{opp.orgName}</span>
                    <PlanChip plan={opp.currentPlan} />
                    <svg
                      className="size-3 shrink-0 text-muted"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <PlanChip plan={opp.targetPlan} />
                  </div>
                  <p className="truncate text-callout text-secondary">{opp.reason}</p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <div className="text-center">
                    <p className="text-callout font-medium tabular-nums text-primary">
                      {opp.signals.activeUsers}/{opp.signals.totalUsers}
                    </p>
                    <p className="text-caption text-secondary">{d.users}</p>
                  </div>
                  <span className="text-subheading font-bold tabular-nums text-success">
                    +{formatCurrency(opp.mrrIncrease, locale)}
                  </span>
                  <StatusBadge tone={CONFIDENCE_TONE[opp.confidence] ?? 'neutral'}>
                    {confidenceLabel[opp.confidence] ?? opp.confidence}
                  </StatusBadge>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
