'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { intlLocale } from '../../../../lib/format-utils';
import {
  useBillingCurrentPlan,
  useBillingCreatePortalSession,
  useBillingCancelSubscription,
} from '../../../../lib/platform-api/billing';
import { Button, ConfirmDialog, ErrorState, Skeleton, StatusBadge, type StatusTone } from '../../../../components';

type T = ReturnType<typeof useI18n>['t'];

export function planLabel(t: T, plan: string | null | undefined): string {
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

function planStatus(t: T, status: string | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case 'active':
      return { label: t.billing.statusActive, tone: 'success' };
    case 'past_due':
      return { label: t.billing.statusPastDue, tone: 'warning' };
    case 'cancelled':
      return { label: t.billing.statusCancelled, tone: 'neutral' };
    default:
      return { label: t.billing.statusTrialing, tone: 'info' };
  }
}

/**
 * "Plan actual": skeleton only while the plan request is pending (settings-09). A resolved `null` (no
 * Subscription row) is a real answer and renders the trial plan, as before.
 */
export function BillingCurrentPlan({ configured }: { configured: boolean }) {
  const { t, locale } = useI18n();
  const plan = useBillingCurrentPlan();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const portal = useBillingCreatePortalSession({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: () => toast(t.billing.manageError, { type: 'error' }),
  });
  const cancel = useBillingCancelSubscription({
    onSuccess: () => {
      setConfirmCancel(false);
      toast(t.billing.cancelScheduled, { type: 'success' });
      // getCurrentPlan's TS tRPC procedure has been deleted — the platform-api query key is
      // the only read path left to invalidate.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'billing', 'plan'] });
    },
    // Project rule: every mutation toasts its failure; the dialog keeps its inline copy too.
    onError: () => toast(t.billing.cancelError, { type: 'error' }),
  });

  const data = plan.data;
  const renewsOn = data?.currentPeriodEnd
    ? new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'long' }).format(new Date(data.currentPeriodEnd))
    : null;
  const hasCustomer = Boolean(data?.stripeCustomerId);
  const hasActiveSub = Boolean(data?.stripeSubscriptionId) && data?.status !== 'cancelled';
  const status = planStatus(t, data?.status);
  const name = planLabel(t, data?.plan ?? null);

  return (
    <section aria-labelledby="billing-plan-title" className="rounded-xl border border-border bg-white p-5">
      <h2 id="billing-plan-title" className="text-subheading font-semibold text-primary">
        {t.billing.currentPlanTitle}
      </h2>
      {plan.isError ? (
        <ErrorState size="compact" onRetry={() => plan.refetch()} />
      ) : plan.isPending ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-4 w-24" />
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-display text-display font-semibold text-brand">{name}</span>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
          {renewsOn && (
            <p className="mt-2 text-callout text-secondary">
              {t.billing.renewsOn} {renewsOn}
            </p>
          )}
          {configured && hasCustomer && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => portal.mutate()}
                loading={portal.isPending}
                loadingLabel={t.billing.redirecting}
              >
                {t.billing.manageBilling}
              </Button>
              {hasActiveSub && (
                <Button
                  variant="destructive-secondary"
                  onClick={() => {
                    cancel.reset();
                    setConfirmCancel(true);
                  }}
                >
                  {t.billing.cancelSubscriptionEllipsis}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title={t.billing.cancelTitle}
          description={
            renewsOn
              ? formatMessage(t.billing.cancelConfirmUntil, { plan: name, date: renewsOn })
              : t.billing.cancelConfirm
          }
          cancelLabel={t.billing.keepSubscription}
          confirmLabel={t.billing.cancelSubscription}
          confirmingLabel={t.billing.cancelling}
          destructive
          loading={cancel.isPending}
          error={cancel.isError ? t.billing.cancelError : undefined}
          onConfirm={() => cancel.mutate()}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </section>
  );
}
