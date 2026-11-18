'use client';

import { formatMessage, useI18n } from '../../../../lib/i18n';
import { formatCurrency, formatNumber } from '../../../../lib/format-utils';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import { MVP_SLUGS } from './agent-catalog';
import type { AgentKpisQuery as KpiQuery } from './query-state';


/** The five registry KPIs. The MVP / post-MVP split is shown only when the catalog is loaded (never negative). */
export function AiAgentKpis({ query }: { query: KpiQuery }) {
  const { t, locale } = useI18n();
  const ai = t.aiAgents;
  const { data: kpis, isLoading, isError, error, refetch } = query;

  if (isLoading) {
    return (
      <div aria-busy="true" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-xl bg-white shadow-card">
        <ErrorState size="compact" onRetry={() => refetch()} error={error} message={ai.kpiLoadError} />
      </div>
    );
  }

  const total = kpis?.total ?? 0;
  const mvp = MVP_SLUGS.length;
  const totalSubtitle =
    total === 0
      ? ai.registryEmpty
      : total >= mvp
        ? formatMessage(ai.mvpBreakdown, { mvp, post: total - mvp })
        : undefined;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <KpiCard label={ai.kpiTotal} value={formatNumber(total, locale)} subtitle={totalSubtitle} />
      <KpiCard
        label={ai.kpiActive}
        value={formatNumber(kpis?.active ?? 0, locale)}
        subtitle={formatMessage(ai.ofTotalPct, { pct: total ? Math.round(((kpis?.active ?? 0) / total) * 100) : 0 })}
      />
      <KpiCard label={ai.kpiStubs} value={kpis?.stubCount ?? 0} subtitle={ai.pendingImpl} tone="warning" />
      <KpiCard
        label={ai.kpiMonthlySpend}
        value={formatCurrency(kpis?.monthlySpend ?? 0, 'USD', 2)}
        subtitle={ai.last30Days}
      />
      <KpiCard
        label={ai.kpiCalls30d}
        value={formatNumber(kpis?.totalCalls30d ?? 0, locale)}
        subtitle={formatMessage(ai.perCall, { cost: formatCurrency(kpis?.avgCostPerCall ?? 0, 'USD', 4) })}
      />
    </div>
  );
}
