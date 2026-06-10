'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

type CheckoutPlan = 'starter' | 'professional';

// Self-serve plan cards. Upgrade → createCheckoutSession → redirect to Stripe's
// hosted checkout. Buttons are disabled when billing is not configured (the UI
// gate; the endpoint also fails closed server-side).
export function BillingPlans({
  currentPlan,
  configured,
}: {
  currentPlan: string | null;
  configured: boolean;
}) {
  const { t } = useI18n();

  const checkout = trpc.billing.createCheckoutSession.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: () => toast(t.billing.checkoutError, { type: 'error' }),
  });

  const cards: { plan: CheckoutPlan; name: string; desc: string }[] = [
    { plan: 'starter', name: t.billing.planStarter, desc: t.billing.starterDesc },
    { plan: 'professional', name: t.billing.planProfessional, desc: t.billing.professionalDesc },
  ];

  return (
    <div className="bg-white border border-[#EDEDED] rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#1F114C]">{t.billing.choosePlanTitle}</h2>
      <p className="text-[12px] text-[#8B8B8B] mt-0.5 mb-4">{t.billing.choosePlanSubtitle}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((c) => {
          const isCurrent = currentPlan === c.plan;
          const isPending = checkout.isPending && checkout.variables?.plan === c.plan;
          return (
            <div key={c.plan} className="flex flex-col border border-[#EDEDED] rounded-lg p-4">
              <div className="text-sm font-semibold text-[#1F114C]">{c.name}</div>
              <p className="text-[12px] text-[#585858] mt-1 flex-1">{c.desc}</p>
              {isCurrent ? (
                <span className="mt-4 inline-flex items-center justify-center h-9 rounded-lg bg-[#F3F1FA] text-[#1F114C] text-[12px] font-medium">
                  {t.billing.currentBadge}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!configured || checkout.isPending}
                  onClick={() => checkout.mutate({ plan: c.plan })}
                  className="mt-4 h-9 rounded-lg bg-[#DD0C15] text-white text-[12px] font-medium disabled:opacity-50"
                >
                  {isPending ? t.billing.redirecting : t.billing.upgrade}
                </button>
              )}
            </div>
          );
        })}

        {/* Enterprise = negotiated; no self-serve checkout. */}
        <div className="flex flex-col border border-[#EDEDED] rounded-lg p-4">
          <div className="text-sm font-semibold text-[#1F114C]">{t.billing.enterpriseTitle}</div>
          <p className="text-[12px] text-[#585858] mt-1 flex-1">{t.billing.enterpriseDesc}</p>
          <a
            href="mailto:ventas@nexadev.ai?subject=TIMS%20ATS%20Enterprise"
            className="mt-4 h-9 inline-flex items-center justify-center rounded-lg border border-[#EDEDED] text-[#585858] text-[12px] font-medium"
          >
            {t.billing.contactSales}
          </a>
        </div>
      </div>
    </div>
  );
}
