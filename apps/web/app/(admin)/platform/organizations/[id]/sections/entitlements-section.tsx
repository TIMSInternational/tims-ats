'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { Skeleton, ErrorState, EmptyState } from '../../../../../../components';
import { EntitlementRow } from './entitlement-row';

const emptyIcon = (
  <svg className="w-10 h-10 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

export function EntitlementsSection({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [selectedPlan, setSelectedPlan] = useState('');

  const { data: entitlements, isLoading, isError, refetch } = trpc.platform.getOrgEntitlements.useQuery({ orgId });
  const { data: plans } = trpc.platform.listPlans.useQuery();

  const setEntitlement = trpc.platform.setOrgEntitlement.useMutation({
    onSuccess: () => {
      utils.platform.getOrgEntitlements.invalidate({ orgId });
      toast(t.entitlementsAdmin.saved, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const applyPlan = trpc.platform.assignPlan.useMutation({
    onSuccess: () => {
      utils.platform.getOrgEntitlements.invalidate({ orgId });
      toast(t.entitlementsAdmin.saved, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const isMutating = setEntitlement.isPending || applyPlan.isPending;

  const handleApplyPlan = () => {
    if (!selectedPlan) return;
    if (!window.confirm(t.entitlementsAdmin.applyPlanConfirm)) return;
    applyPlan.mutate({ orgId, planCode: selectedPlan });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#333]">{t.entitlementsAdmin.title}</h3>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#8B8B8B]">{t.entitlementsAdmin.planLabel}</label>
          <select
            value={selectedPlan}
            onChange={(e) => setSelectedPlan(e.target.value)}
            disabled={isMutating}
            className="h-8 px-2 rounded-lg border border-[#EDEDED] text-xs text-[#333] disabled:opacity-50"
          >
            <option value="">{t.entitlementsAdmin.selectPlan}</option>
            {(plans ?? []).map((p) => (
              <option key={p.code} value={p.code}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleApplyPlan}
            disabled={!selectedPlan || isMutating}
            className="h-8 px-3 rounded-lg bg-[#1F114C] text-xs text-white font-medium hover:bg-[#2a1866] transition disabled:opacity-50"
          >
            {t.entitlementsAdmin.applyPlan}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between animate-pulse">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-11 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-28 rounded-lg" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : !entitlements || entitlements.length === 0 ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <EmptyState icon={emptyIcon} message={t.entitlementsAdmin.empty} />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-[#EDEDED]">
                <th className="px-5 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.entitlementsAdmin.moduleCol}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.entitlementsAdmin.enabledCol}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.entitlementsAdmin.limitCol}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.entitlementsAdmin.unitPriceCol}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.entitlementsAdmin.sourceCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F3F3]">
              {entitlements.map((e) => (
                <EntitlementRow
                  key={`${e.moduleCode}:${e.limit}:${e.source}`}
                  entitlement={e}
                  disabled={isMutating}
                  onToggle={(moduleCode, enabled) => setEntitlement.mutate({ orgId, moduleCode, enabled })}
                  onLimitCommit={(moduleCode, limit) => setEntitlement.mutate({ orgId, moduleCode, limit })}
                  onUnitPriceCommit={(moduleCode, unitPrice) => setEntitlement.mutate({ orgId, moduleCode, unitPrice })}
                />
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
