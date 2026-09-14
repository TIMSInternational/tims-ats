'use client';

import { useRouter } from 'next/navigation';
import { useDashboardAiCostAnomalies } from '../../../../lib/platform-api/dashboard';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';

const TYPE_CONFIG = {
  zero_usage: { bg: 'bg-amber-50', dot: 'bg-amber-500', label: 'Zero usage' },
  over_budget: { bg: 'bg-red-50', dot: 'bg-red-500', label: 'Over budget' },
  high_cost: { bg: 'bg-violet-50', dot: 'bg-violet-500', label: 'High cost' },
} as const;

export function AiCostAnomalyPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useDashboardAiCostAnomalies();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <Skeleton className="h-4 w-44 mb-2" />
        <Skeleton className="h-3 w-56 mb-4" />
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
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data || data.anomalies.length === 0) {
    return (
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <h3 className="text-sm font-semibold text-[#1F114C] mb-1">{t.dashboard.aiCostTitle ?? 'AI Cost Anomalies'}</h3>
        <div className="py-6 text-center">
          <svg
            className="w-8 h-8 text-emerald-300 mx-auto mb-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-[#8B8B8B]">{t.dashboard.noAnomalies ?? 'No cost anomalies detected'}</p>
          <p className="text-xs text-[#8B8B8B] mt-0.5">
            {t.dashboard.allOptimized ?? 'All AI agents optimally configured'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#EDEDED] bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-[#1F114C]">{t.dashboard.aiCostTitle ?? 'AI Cost Anomalies'}</h3>
          <p className="text-xs text-[#8B8B8B]">
            {t.dashboard.aiCostSubtitle ?? 'Agents with unusual spending patterns'}
          </p>
        </div>
        {data.totalPotentialSavings > 0 && (
          <div className="text-right">
            <p className="text-lg font-bold text-amber-600">{formatCurrency(data.totalPotentialSavings)}</p>
            <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.potentialSavings ?? 'potential savings'}</p>
          </div>
        )}
      </div>

      {/* Summary pills */}
      <div className="flex gap-2 mb-4">
        {data.zeroUsageCount > 0 && (
          <span className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs font-medium text-amber-700">{data.zeroUsageCount}</span>
            <span className="text-[10px] text-amber-600">{t.dashboard.zeroUsage ?? 'zero usage'}</span>
          </span>
        )}
        {data.overBudgetCount > 0 && (
          <span className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs font-medium text-red-700">{data.overBudgetCount}</span>
            <span className="text-[10px] text-red-600">{t.dashboard.overBudget ?? 'over budget'}</span>
          </span>
        )}
      </div>

      {/* Anomalies list */}
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {data.anomalies.slice(0, 10).map((anomaly, i) => {
          const cfg = TYPE_CONFIG[anomaly.type] ?? TYPE_CONFIG.zero_usage;
          return (
            <button
              key={`${anomaly.agentSlug}-${anomaly.orgId}-${i}`}
              onClick={() => router.push('/platform/ai-agents')}
              className={`w-full text-left rounded-lg px-4 py-2.5 transition-all hover:shadow-sm ${cfg.bg}`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[#333] truncate">{anomaly.agentName}</span>
                    <span className="text-[10px] text-[#8B8B8B]">{anomaly.orgName}</span>
                  </div>
                  <p className="text-[11px] text-[#585858]">{anomaly.detail}</p>
                </div>
                <span className="text-xs font-bold text-amber-600 shrink-0">
                  {formatCurrency(anomaly.potentialSavings)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
