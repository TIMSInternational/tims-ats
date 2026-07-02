'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, PLAN_BG_CLASSES, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';

const TIER_CONFIG = {
  green: { bg: 'bg-emerald-500', text: 'text-emerald-700', light: 'bg-emerald-50' },
  yellow: { bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-50' },
  red: { bg: 'bg-red-500', text: 'text-red-700', light: 'bg-red-50' },
} as const;

function getActionLabel(action: string, t: ReturnType<typeof useI18n>['t']): string {
  const map: Record<string, string> = {
    send_dunning: t.dashboard.sendDunning,
    reactivation_email: t.dashboard.reactivationEmail,
    check_in: t.dashboard.checkIn,
    adoption_call: t.dashboard.adoptionCall,
    onboarding_session: t.dashboard.onboardingSession,
    conversion_call: t.dashboard.conversionCall,
  };
  return map[action] ?? action;
}

export function ChurnRiskPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = trpc.platform.getChurnRisk.useQuery();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-3 w-48 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
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

  if (!data) return null;

  const { organizations, summary } = data;
  // Show only at-risk and critical by default, max 10
  const atRiskOrgs = organizations.filter((o) => o.tier !== 'green').slice(0, 10);

  return (
    <div className="rounded-xl border border-[#EDEDED] bg-white p-5 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-[#1F114C]">{t.dashboard.churnRisk}</h3>
          <p className="text-xs text-[#8B8B8B]">{t.dashboard.churnSubtitle}</p>
        </div>
        {summary.atRiskMrr > 0 && (
          <div className="text-right">
            <p className="text-lg font-bold text-[#DD0C15]">{formatCurrency(summary.atRiskMrr)}</p>
            <p className="text-[10px] text-[#8B8B8B]">{t.dashboard.atRiskMrr}</p>
          </div>
        )}
      </div>

      {/* Summary pills */}
      <div className="flex gap-2 mb-4">
        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-medium text-emerald-700">{summary.green}</span>
          <span className="text-[10px] text-emerald-600">{t.dashboard.green}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-xs font-medium text-amber-700">{summary.yellow}</span>
          <span className="text-[10px] text-amber-600">{t.dashboard.yellow}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-xs font-medium text-red-700">{summary.red}</span>
          <span className="text-[10px] text-red-600">{t.dashboard.red}</span>
        </div>
      </div>

      {/* Table */}
      {atRiskOrgs.length === 0 ? (
        <div className="py-8 text-center">
          <svg className="w-8 h-8 text-emerald-300 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="text-sm text-[#8B8B8B]">{t.dashboard.noOrgsAtRisk}</p>
          <p className="text-xs text-[#8B8B8B] mt-0.5">{t.dashboard.noOrgsAtRiskDesc}</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
          {atRiskOrgs.map((org) => {
            const tierCfg = TIER_CONFIG[org.tier];
            const planClass = PLAN_BG_CLASSES[org.plan] ?? 'bg-gray-100 text-gray-700';
            const primaryAction = org.actions[0];

            return (
              <button
                key={org.orgId}
                onClick={() => router.push(`/platform/organizations/${org.orgId}`)}
                className={`w-full text-left rounded-lg border px-4 py-3 transition-all hover:shadow-sm ${tierCfg.light} border-transparent hover:border-[#EDEDED]`}
              >
                <div className="flex items-center gap-3">
                  {/* Health score bar */}
                  <div className="w-10 shrink-0">
                    <div className="flex items-center justify-center">
                      <span className={`text-sm font-bold ${tierCfg.text}`}>{org.healthScore}</span>
                    </div>
                    <div className="w-full bg-[#EDEDED] rounded-full h-1.5 mt-0.5">
                      <div
                        className={`h-1.5 rounded-full ${tierCfg.bg}`}
                        style={{ width: `${org.healthScore}%` }}
                      />
                    </div>
                  </div>

                  {/* Org info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[#333] truncate">{org.orgName}</span>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${planClass}`}>
                        {PLAN_LABELS[org.plan] ?? org.plan}
                      </span>
                      {org.mrr > 0 && (
                        <span className="text-[10px] text-[#8B8B8B]">{formatCurrency(org.mrr)}/mo</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#585858] truncate">{org.primaryRisk}</p>
                  </div>

                  {/* Signals */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-center">
                      <p className={`text-[12px] font-medium ${org.loginRate < 30 ? 'text-[#DD0C15]' : 'text-[#333]'}`}>
                        {org.loginRate}%
                      </p>
                      <p className="text-[9px] text-[#8B8B8B]">{t.dashboard.loginRate}</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-[12px] font-medium ${org.overdueInvoices > 0 ? 'text-[#DD0C15]' : 'text-[#333]'}`}>
                        {org.overdueInvoices}
                      </p>
                      <p className="text-[9px] text-[#8B8B8B]">{t.dashboard.overdue}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[12px] font-medium text-[#333]">{org.featureCount}</p>
                      <p className="text-[9px] text-[#8B8B8B]">{t.dashboard.features}</p>
                    </div>
                  </div>

                  {/* Action button */}
                  {primaryAction && (
                    <span className="text-[10px] text-[#DD0C15] font-medium border border-red-200 rounded px-2 py-1 shrink-0 hover:bg-red-50">
                      {getActionLabel(primaryAction, t)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
