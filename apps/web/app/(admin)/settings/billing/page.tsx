'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../../../../lib/i18n';
import { useBillingConfig, useBillingCurrentPlan } from '../../../../lib/platform-api/billing';
import { toast } from '../../../../lib/toast';
import { ErrorState, PageHeader } from '../../../../components';
import { BillingCurrentPlan } from './billing-current-plan';
import { BillingUsage } from './billing-usage';
import { BillingPlans } from './billing-plans';
import { BillingInvoices } from './billing-invoices';
import { NotConfiguredNotice } from './not-configured-notice';

export default function BillingPage() {
  const { t } = useI18n();
  const config = useBillingConfig();
  const plan = useBillingCurrentPlan();

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

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.billing.title} description={t.billing.description} />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {config.isError ? (
          <ErrorState size="compact" onRetry={() => config.refetch()} />
        ) : (
          !config.isLoading && !configured && <NotConfiguredNotice />
        )}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          <BillingCurrentPlan configured={configured} />
          <BillingUsage />
        </div>

        <BillingPlans currentPlan={currentPlan} configured={configured} loading={plan.isLoading || config.isLoading} />
        <BillingInvoices />
      </div>
    </div>
  );
}
