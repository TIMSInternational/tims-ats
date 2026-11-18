'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { Button, ConfirmDialog, EmptyState, ErrorState, Skeleton, selectClasses } from '../../../../../../components';
import { EntitlementRow } from './entitlement-row';

const emptyIcon = (
  <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
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

  // One click used to flip a module (e.g. ai_voice_interview, which must stay off in the pilot) with no
  // confirmation (D-14).
  const [pendingToggle, setPendingToggle] = useState<{ moduleCode: string; name: string; enabled: boolean } | null>(null);
  const [confirmPlan, setConfirmPlan] = useState(false);
  const handleToggle = (moduleCode: string, moduleName: string, enabled: boolean) => {
    setPendingToggle({ moduleCode, name: moduleName, enabled });
  };

  const handleApplyPlan = () => {
    if (!selectedPlan) return;
    setConfirmPlan(false);
    applyPlan.mutate({ orgId, planCode: selectedPlan });
  };
  const e = t.entitlementsAdmin;
  const TH = 'px-4 py-2.5 text-callout font-semibold text-secondary';
  const CARD = 'rounded-xl bg-white shadow-card';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-subheading font-semibold text-primary">{e.title}</h2>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:flex-none">
            <label htmlFor="entitlements-plan" className="mb-1 block text-callout font-medium text-secondary">{e.planLabel}</label>
            <select
              id="entitlements-plan"
              value={selectedPlan}
              onChange={(ev) => setSelectedPlan(ev.target.value)}
              disabled={isMutating}
              className={selectClasses('md', 'sm:w-56')}
            >
              <option value="">{e.selectPlan}</option>
              {(plans ?? []).map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={() => setConfirmPlan(true)} disabled={!selectedPlan || isMutating}>
            {e.applyPlanEllipsis}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className={`${CARD} space-y-4 p-5`} aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-11 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-28 rounded-lg" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className={CARD}>
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : !entitlements || entitlements.length === 0 ? (
        <div className={CARD}>
          <EmptyState icon={emptyIcon} message={e.empty} />
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">{e.title}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={TH}>{e.moduleCol}</th>
                <th scope="col" className={TH}>{e.enabledCol}</th>
                <th scope="col" className={TH}>{e.limitCol}</th>
                <th scope="col" className={TH}>{e.unitPriceCol}</th>
                <th scope="col" className={TH}>{e.sourceCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entitlements.map((ent) => (
                <EntitlementRow
                  key={`${ent.moduleCode}:${ent.limit}:${ent.source}`}
                  entitlement={ent}
                  disabled={isMutating}
                  onToggle={(moduleCode, enabled) => handleToggle(moduleCode, ent.name, enabled)}
                  onLimitCommit={(moduleCode, limit) => setEntitlement.mutate({ orgId, moduleCode, limit })}
                  onUnitPriceCommit={(moduleCode, unitPrice) => setEntitlement.mutate({ orgId, moduleCode, unitPrice })}
                />
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      {pendingToggle && (
        <ConfirmDialog
          title={(pendingToggle.enabled ? e.toggleOnConfirm : e.toggleOffConfirm).replace('{module}', pendingToggle.name)}
          confirmLabel={pendingToggle.enabled ? e.enableModule : e.disableModule}
          destructive={!pendingToggle.enabled}
          onConfirm={() => {
            setEntitlement.mutate({ orgId, moduleCode: pendingToggle.moduleCode, enabled: pendingToggle.enabled });
            setPendingToggle(null);
          }}
          onCancel={() => setPendingToggle(null)}
        />
      )}
      {confirmPlan && (
        <ConfirmDialog
          title={e.applyPlanConfirmTitle}
          description={e.applyPlanConfirmBody}
          confirmLabel={e.applyPlan}
          onConfirm={handleApplyPlan}
          onCancel={() => setConfirmPlan(false)}
        />
      )}
    </div>
  );
}
