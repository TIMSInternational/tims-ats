'use client';

import { useState } from 'react';
import { Button, CHOICE_INPUT_CLASSES, Modal, StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatCurrency } from '../../../../lib/format-utils';
import { planLabel } from '../organizations/plan-label';

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

export function PlanChangeModal({ orgName, currentPlan, onConfirm, onClose, isPending }: PlanChangeModalProps) {
  const { t } = useI18n();
  const sb = t.subscriptions;
  const current = currentPlan.toLowerCase();
  const [selected, setSelected] = useState(current);
  const perMonth = (plan: string) => formatMessage(sb.perMonth, { amount: formatCurrency(PLAN_PRICES[plan] ?? 0) });

  return (
    <Modal
      title={formatMessage(sb.changePlanTitle, { org: orgName })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={selected === current} loading={isPending} loadingLabel={t.common.saving}>
            {sb.changePlanBtn}
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">{sb.newPlan}</legend>
        {PLANS.map((plan) => {
          const isCurrent = plan === current;
          return (
            <label
              key={plan}
              className={`flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-tint pointer-coarse:min-h-11 ${
                isCurrent ? 'cursor-not-allowed bg-surface' : 'cursor-pointer hover:border-field-border'
              }`}
            >
              <span className="flex flex-wrap items-center gap-3">
                <input
                  type="radio"
                  name="plan-change"
                  value={plan}
                  checked={plan === selected}
                  disabled={isCurrent}
                  onChange={() => setSelected(plan)}
                  className={CHOICE_INPUT_CLASSES}
                />
                <span className="text-body font-medium text-primary">{planLabel(plan, t)}</span>
                {isCurrent && <StatusBadge tone="brand" icon="none">{sb.currentPlan}</StatusBadge>}
              </span>
              <span className="text-body font-semibold tabular-nums text-primary">{perMonth(plan)}</span>
            </label>
          );
        })}
      </fieldset>

      {selected !== current && (
        <p className="mt-4 rounded-lg bg-info-bg p-3 text-callout text-info">
          {formatMessage(sb.priceChangeLine, { from: perMonth(current), to: perMonth(selected) })}
        </p>
      )}
    </Modal>
  );
}
