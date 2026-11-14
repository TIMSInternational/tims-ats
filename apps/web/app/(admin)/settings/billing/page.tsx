'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../../../../lib/i18n';
import { useBillingConfig, useBillingCurrentPlan } from '../../../../lib/platform-api/billing';
import { toast } from '../../../../lib/toast';
import { getSupportEmail } from '../../../../lib/support-email';
import { ErrorState, PageHeader, TEXT_LINK_CLASSES } from '../../../../components';
import { BillingCurrentPlan } from './billing-current-plan';
import { BillingUsage } from './billing-usage';
import { BillingPlans } from './billing-plans';
import { BillingInvoices } from './billing-invoices';

function NotConfiguredNotice() {
  const { t } = useI18n();
  const supportEmail = getSupportEmail();
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-warning/30 bg-warning-bg p-4">
      <svg
        className="mt-0.5 size-4 shrink-0 text-warning"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
      <div>
        <p className="text-subheading font-semibold text-warning">{t.billing.notConfiguredTitle}</p>
        <p className="mt-1 text-callout text-primary">
          {t.billing.notConfiguredDesc}{' '}
          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className={TEXT_LINK_CLASSES}>
              {t.billing.contactSupport}
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

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
