'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, formatNumber } from '../../../../lib/format-utils';
import { ErrorState, Skeleton } from '../../../../components';
import type { AgentUsageQuery as UsageQuery } from './query-state';


function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-surface p-3">
      <dt className="text-callout text-secondary">{label}</dt>
      <dd className="mt-0.5 text-title font-semibold tabular-nums text-brand">{value}</dd>
    </div>
  );
}

/** Last-30-day usage of one agent. */
export function AgentUsageTab({ usage }: { usage: UsageQuery }) {
  const { t, locale } = useI18n();
  const ai = t.aiAgents;

  if (usage.isLoading) {
    return (
      <div aria-busy="true" className="grid grid-cols-2 gap-3">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (usage.isError) {
    return (
      <ErrorState size="compact" onRetry={() => usage.refetch()} error={usage.error} message={ai.usageLoadError} />
    );
  }
  if (!usage.data) return null;
  const data = usage.data;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3">
        <Stat value={formatNumber(data.totalCalls, locale)} label={ai.calls30d} />
        <Stat value={formatCurrency(data.totalCost, 'USD', 2)} label={ai.totalCost} />
        <Stat value={`${formatNumber(data.avgLatencyMs, locale)} ms`} label={ai.avgLatency} />
        <Stat value={formatCurrency(data.avgCostPerCall, 'USD', 4)} label={ai.colCost} />
      </dl>
      <div className="rounded-lg bg-surface p-3">
        <h3 className="mb-2 text-body font-semibold text-brand">{ai.tokens}</h3>
        <dl className="space-y-1 text-body">
          <div className="flex justify-between">
            <dt className="text-secondary">{ai.tokensInput}</dt>
            <dd className="font-medium tabular-nums text-primary">{formatNumber(data.totalInputTokens, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-secondary">{ai.tokensOutput}</dt>
            <dd className="font-medium tabular-nums text-primary">{formatNumber(data.totalOutputTokens, locale)}</dd>
          </div>
        </dl>
      </div>
      {data.totalCalls === 0 && <p className="text-center text-callout text-secondary">{ai.noUsageData}</p>}
    </div>
  );
}
