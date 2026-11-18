'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useCan } from '../../../../../lib/permissions';
import { CHOICE_INPUT_CLASSES } from '../../../../../components/field-styles';

export interface OfferLegalCheck {
  id: string;
  checkName: string;
  completed: boolean;
  completedAt: Date | string | null;
  completedByUser: { id: string; firstName: string; lastName: string } | null;
}

/** A legal checklist item as a native checkbox: its checked state is announced (accessibility.md › Vision). */
export function OfferLegalCheckItem({ check, offerId, readOnly }: { check: OfferLegalCheck; offerId: string; readOnly: boolean }) {
  const { t } = useI18n();
  const can = useCan();
  const utils = trpc.useUtils();
  const updateCheck = trpc.offer.updateLegalCheck.useMutation({
    onSuccess: () => {
      utils.offer.getLegalChecklist.invalidate({ offerId });
      utils.offer.getById.invalidate({ id: offerId });
    },
    onError: () => toast(t.offers.errorUpdateVerification, { type: 'error' }),
  });
  const disabled = readOnly || !can('offer', 'update') || updateCheck.isPending;

  return (
    <li>
      <label className={`flex min-h-7 items-center gap-2 pointer-coarse:min-h-11 ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={check.completed}
          disabled={disabled}
          onChange={() => updateCheck.mutate({ id: check.id, completed: !check.completed })}
          className={CHOICE_INPUT_CLASSES}
        />
        <span className="text-callout text-primary">{check.checkName}</span>
      </label>
    </li>
  );
}
