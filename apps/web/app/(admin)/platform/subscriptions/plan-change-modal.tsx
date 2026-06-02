'use client';

import { useState } from 'react';
import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency } from '../../../../lib/format-utils';

const PLANS = ['starter', 'professional', 'enterprise'] as const;
const PLAN_PRICES: Record<string, number> = {
  starter: 499,
  professional: 999,
  enterprise: 2499,
};

interface PlanChangeModalProps {
  orgName: string;
  currentPlan: string;
  onConfirm: (newPlan: string) => void;
  onClose: () => void;
  isPending: boolean;
}

export function PlanChangeModal({
  orgName,
  currentPlan,
  onConfirm,
  onClose,
  isPending,
}: PlanChangeModalProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(currentPlan);

  return (
    <Modal title={`${t.subscriptions.confirmPlanChange} ${orgName}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          {PLANS.map((plan) => {
            const isCurrent = plan === currentPlan.toLowerCase();
            const isSelected = plan === selected;
            return (
              <button
                key={plan}
                onClick={() => setSelected(plan)}
                disabled={isCurrent}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition ${
                  isSelected && !isCurrent
                    ? 'border-[#1F114C] bg-[#1F114C]/5'
                    : isCurrent
                      ? 'border-[#EDEDED] bg-[#F6F6F6] opacity-60 cursor-not-allowed'
                      : 'border-[#EDEDED] hover:border-[#8B8B8B]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full border-2 ${
                    isSelected && !isCurrent ? 'border-[#1F114C] bg-[#1F114C]' : 'border-[#EDEDED]'
                  }`} />
                  <span className="text-sm font-medium text-[#333] capitalize">{plan}</span>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1F114C]/10 text-[#1F114C] font-bold">
                      {t.subscriptions.currentPlan}
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold text-[#333]">
                  {formatCurrency(PLAN_PRICES[plan])}/mo
                </span>
              </button>
            );
          })}
        </div>

        {selected !== currentPlan.toLowerCase() && (
          <div className="p-3 rounded-lg bg-blue-50 text-xs text-blue-700">
            {t.subscriptions.priceChange}: {formatCurrency(PLAN_PRICES[currentPlan.toLowerCase()] || 0)} → {formatCurrency(PLAN_PRICES[selected])}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={() => onConfirm(selected)}
            disabled={isPending || selected === currentPlan.toLowerCase()}
            className="h-9 px-4 rounded-lg bg-[#1F114C] text-sm text-white font-medium hover:bg-[#2a1866] transition disabled:opacity-50"
          >
            {isPending ? t.common.saving : t.common.confirm}
          </button>
        </div>
      </div>
    </Modal>
  );
}
