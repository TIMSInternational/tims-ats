'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { BillingPlans } from './billing-plans';

type T = ReturnType<typeof useI18n>['t'];

function planLabel(t: T, plan: string | null | undefined): string {
  switch (plan) {
    case 'starter':
      return t.billing.planStarter;
    case 'professional':
      return t.billing.planProfessional;
    case 'enterprise':
      return t.billing.planEnterprise;
    default:
      return t.billing.planTrial;
  }
}

function statusLabel(t: T, status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return t.billing.statusActive;
    case 'past_due':
      return t.billing.statusPastDue;
    case 'cancelled':
      return t.billing.statusCancelled;
    default:
      return t.billing.statusTrialing;
  }
}

function UsageRow({ label, used, limit, noLimit }: { label: string; used: number; limit: number | null; noLimit: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#F2F2F2] last:border-0">
      <span className="text-[12px] text-[#585858]">{label}</span>
      <span className="text-[13px] font-medium text-[#1F114C]">
        {used}
        <span className="text-[#8B8B8B] font-normal"> / {limit ?? noLimit}</span>
      </span>
    </div>
  );
}

export default function BillingPage() {
  const { t } = useI18n();
  const config = trpc.billing.getBillingConfig.useQuery();
  const plan = trpc.billing.getCurrentPlan.useQuery();
  const usage = trpc.billing.getUsage.useQuery();
  const utils = trpc.useUtils();

  const portal = trpc.billing.createPortalSession.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: () => toast(t.billing.manageError, { type: 'error' }),
  });
  const cancel = trpc.billing.cancelSubscription.useMutation({
    onSuccess: () => {
      toast(t.billing.cancelScheduled, { type: 'success' });
      utils.billing.getCurrentPlan.invalidate();
    },
    onError: () => toast(t.billing.cancelError, { type: 'error' }),
  });

  // Surface the Stripe checkout return state (?checkout=success|cancelled) once.
  const params = useSearchParams();
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    const result = params.get('checkout');
    if (result === 'success') {
      toast(t.billing.checkoutSuccess, { type: 'success' });
      handled.current = true;
    } else if (result === 'cancelled') {
      toast(t.billing.checkoutCancelled, { type: 'info' });
      handled.current = true;
    }
  }, [params, t]);

  const configured = config.data?.configured ?? false;
  const currentPlan = plan.data?.plan ?? null;
  const renewsOn = plan.data?.currentPeriodEnd
    ? new Date(plan.data.currentPeriodEnd).toLocaleDateString()
    : null;
  const hasCustomer = Boolean(plan.data?.stripeCustomerId);
  const hasActiveSub = Boolean(plan.data?.stripeSubscriptionId) && plan.data?.status !== 'cancelled';

  const onCancel = () => {
    if (window.confirm(t.billing.cancelConfirm)) cancel.mutate();
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <span className="text-[13px] text-[#8B8B8B]">{t.billing.breadcrumbParent}</span>
        <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
        <span className="text-sm font-medium text-[#1F114C]">{t.billing.title}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        {!config.isLoading && !configured && (
          <div className="bg-[#FFF7E6] border border-[#FFE2A8] rounded-xl p-4">
            <div className="text-sm font-semibold text-[#7A5B00]">{t.billing.notConfiguredTitle}</div>
            <p className="text-[12px] text-[#7A5B00]/80 mt-1">{t.billing.notConfiguredDesc}</p>
          </div>
        )}

        {/* Current plan + usage */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-[#EDEDED] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[#1F114C]">{t.billing.currentPlanTitle}</h2>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[#1F114C]">{planLabel(t, currentPlan)}</span>
              <span className="text-[12px] text-[#8B8B8B]">· {statusLabel(t, plan.data?.status)}</span>
            </div>
            {renewsOn && (
              <p className="text-[12px] text-[#8B8B8B] mt-2">{t.billing.renewsOn} {renewsOn}</p>
            )}
            {configured && hasCustomer && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => portal.mutate()}
                  disabled={portal.isPending}
                  className="h-9 px-4 rounded-lg border border-[#EDEDED] text-[#1F114C] text-[12px] font-medium disabled:opacity-50"
                >
                  {portal.isPending ? t.billing.redirecting : t.billing.manageBilling}
                </button>
                {hasActiveSub && (
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={cancel.isPending}
                    className="h-9 px-4 rounded-lg border border-[#F3C0C2] text-[#DD0C15] text-[12px] font-medium disabled:opacity-50"
                  >
                    {t.billing.cancelSubscription}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="bg-white border border-[#EDEDED] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[#1F114C] mb-2">{t.billing.usageTitle}</h2>
            {usage.data && (
              <div>
                <UsageRow label={t.billing.usageEmployees} used={usage.data.employees.used} limit={usage.data.employees.limit} noLimit={t.billing.noLimit} />
                <UsageRow label={t.billing.usageVacancies} used={usage.data.vacancies.used} limit={usage.data.vacancies.limit} noLimit={t.billing.noLimit} />
                <UsageRow label={t.billing.usageAssessments} used={usage.data.assessments.used} limit={usage.data.assessments.limit} noLimit={t.billing.noLimit} />
              </div>
            )}
          </div>
        </div>

        <BillingPlans currentPlan={currentPlan} configured={configured} />
      </div>
    </div>
  );
}
