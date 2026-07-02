'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, PLAN_BG_CLASSES, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';

const CONFIDENCE_CONFIG = {
  high: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  medium: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  low: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-600', badge: 'bg-gray-100 text-gray-600' },
} as const;

export function UpsellPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = trpc.platform.getUpsellOpportunities.useQuery();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <Skeleton className="h-4 w-40 mb-2" />
        <Skeleton className="h-3 w-56 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
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

  if (!data || data.opportunities.length === 0) {
    return (
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <h3 className="text-sm font-semibold text-[#1F114C] mb-1">{t.dashboard.upsellTitle ?? 'Upsell Opportunities'}</h3>
        <div className="py-6 text-center">
          <svg className="w-8 h-8 text-[#EDEDED] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
          <p className="text-sm text-[#8B8B8B]">{t.dashboard.noUpsells ?? 'No upsell opportunities right now'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#EDEDED] bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-[#1F114C]">{t.dashboard.upsellTitle ?? 'Upsell Opportunities'}</h3>
          <p className="text-xs text-[#8B8B8B]">{t.dashboard.upsellSubtitle ?? 'Organizations ready to upgrade'}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-emerald-600">+{formatCurrency(data.totalPotentialMrr)}</p>
          <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.potentialMrr ?? 'potential MRR'}</p>
        </div>
      </div>

      {/* Confidence summary */}
      <div className="flex gap-2 mb-4">
        {data.highConfidence > 0 && (
          <span className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-emerald-700">{data.highConfidence}</span>
            <span className="text-[10px] text-emerald-600">{t.dashboard.highConfidence ?? 'high'}</span>
          </span>
        )}
        {data.mediumConfidence > 0 && (
          <span className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs font-medium text-amber-700">{data.mediumConfidence}</span>
            <span className="text-[10px] text-amber-600">{t.dashboard.mediumConfidence ?? 'medium'}</span>
          </span>
        )}
      </div>

      {/* Opportunities list */}
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {data.opportunities.slice(0, 8).map((opp) => {
          const conf = CONFIDENCE_CONFIG[opp.confidence];
          const planClass = PLAN_BG_CLASSES[opp.currentPlan] ?? 'bg-gray-100 text-gray-700';
          const targetPlanClass = PLAN_BG_CLASSES[opp.targetPlan] ?? 'bg-gray-100 text-gray-700';

          return (
            <button
              key={opp.orgId}
              onClick={() => router.push(`/platform/organizations/${opp.orgId}`)}
              className="w-full text-left rounded-lg border border-transparent px-4 py-3 transition-all hover:shadow-sm hover:border-[#EDEDED] bg-[#FAFAFA]"
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-medium text-[#333] truncate">{opp.orgName}</span>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${planClass}`}>
                      {PLAN_LABELS[opp.currentPlan] ?? opp.currentPlan}
                    </span>
                    <svg className="w-3 h-3 text-[#8B8B8B] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${targetPlanClass}`}>
                      {PLAN_LABELS[opp.targetPlan] ?? opp.targetPlan}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#585858] truncate">{opp.reason}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-center">
                    <p className="text-[12px] font-medium text-[#333]">{opp.signals.activeUsers}/{opp.signals.totalUsers}</p>
                    <p className="text-[9px] text-[#8B8B8B]">{t.dashboard.users ?? 'users'}</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-600">+{formatCurrency(opp.mrrIncrease)}</span>
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${conf.badge}`}>
                    {opp.confidence}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
