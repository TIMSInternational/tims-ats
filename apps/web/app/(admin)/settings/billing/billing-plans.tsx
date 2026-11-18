'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { useBillingCreateCheckoutSession } from '../../../../lib/platform-api/billing';
import { Button, Skeleton, StatusBadge } from '../../../../components';

type CheckoutPlan = 'starter' | 'professional';
type PlanId = CheckoutPlan | 'enterprise';

// starter < professional < enterprise: the button says which way the change goes (buttons.md › Content).
const PLAN_RANK: Record<string, number> = { starter: 1, professional: 2, enterprise: 3 };

interface BillingPlansProps {
  currentPlan: string | null;
  configured: boolean;
  /** The current plan is still loading: no card may claim (or deny) being current yet. */
  loading?: boolean;
}

// Self-serve plan cards. Change → createCheckoutSession → redirect to Stripe's
// hosted checkout. Buttons are hidden when billing is not configured (the UI
// gate; the endpoint also fails closed server-side).
export function BillingPlans({ currentPlan, configured, loading = false }: BillingPlansProps) {
  const { t } = useI18n();

  const checkout = useBillingCreateCheckoutSession({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: () => toast(t.billing.checkoutError, { type: 'error' }),
  });

  const cards: { plan: PlanId; name: string; desc: string }[] = [
    { plan: 'starter', name: t.billing.planStarter, desc: t.billing.starterDesc },
    { plan: 'professional', name: t.billing.planProfessional, desc: t.billing.professionalDesc },
    { plan: 'enterprise', name: t.billing.enterpriseTitle, desc: t.billing.enterpriseDesc },
  ];
  const currentRank = currentPlan ? (PLAN_RANK[currentPlan] ?? 0) : 0;

  function action(plan: PlanId, name: string) {
    if (loading) return <Skeleton className="h-9 w-full rounded-lg" />;
    if (plan === 'enterprise') {
      return (
        <Button variant="secondary" fullWidth href="mailto:ventas@nexadev.ai?subject=TIMS%20ATS%20Enterprise">
          {t.billing.contactSales}
        </Button>
      );
    }
    if (!configured) return <p className="text-callout text-secondary">{t.billing.notAvailableYet}</p>;
    const isPending = checkout.isPending && checkout.variables?.plan === plan;
    const label = formatMessage(PLAN_RANK[plan] > currentRank ? t.billing.upgradeTo : t.billing.switchTo, {
      plan: name,
    });
    return (
      <Button
        variant="secondary"
        fullWidth
        disabled={checkout.isPending && !isPending}
        loading={isPending}
        loadingLabel={t.billing.redirecting}
        onClick={() => checkout.mutate({ plan })}
      >
        {label}
      </Button>
    );
  }

  return (
    <section aria-labelledby="billing-plans-title" className="rounded-xl border border-border bg-white p-5">
      <h2 id="billing-plans-title" className="text-subheading font-semibold text-primary">
        {t.billing.choosePlanTitle}
      </h2>
      <p className="mb-4 mt-0.5 text-callout text-secondary">{t.billing.choosePlanSubtitle}</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((c) => {
          const isCurrent = !loading && currentPlan === c.plan;
          return (
            <div
              key={c.plan}
              className={`flex flex-col rounded-lg border p-4 ${isCurrent ? 'border-brand' : 'border-border'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-subheading font-semibold text-brand">{c.name}</h3>
                {isCurrent && <StatusBadge tone="brand">{t.billing.currentBadge}</StatusBadge>}
              </div>
              <p className="mt-1 flex-1 text-callout text-secondary">{c.desc}</p>
              {!isCurrent && <div className="mt-4">{action(c.plan, c.name)}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
