'use client';

import { useId } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button, BUTTON_GROUP_CLASSES } from '../../../../components';

interface ModalActionsProps {
  onCancel: () => void;
  onSubmit: () => void;
  /** The verb that names the outcome ("Crear compromiso", "Enviar"). */
  submitLabel: string;
  /** Required data is present. While false the submit is disabled and `hint` says why. */
  isComplete: boolean;
  isPending: boolean;
  /** What is still missing, linked to the disabled submit with aria-describedby. */
  hint?: string;
  /** Busy label for the submit (defaults to t.common.saving). */
  pendingLabel?: string;
}

/**
 * A Modal footer (foundation §9): Cancel (secondary) leading, ONE navy primary trailing, and a hint
 * for a disabled submit so it is never silently blocked (entering-data.md).
 */
export function ModalActions({
  onCancel,
  onSubmit,
  submitLabel,
  isComplete,
  isPending,
  hint,
  pendingLabel,
}: ModalActionsProps) {
  const { t } = useI18n();
  const hintId = useId();
  const showHint = !isComplete && !!hint;
  return (
    <div className="space-y-2">
      {showHint && (
        <p id={hintId} className="text-callout text-secondary sm:text-right">
          {hint}
        </p>
      )}
      <div className={BUTTON_GROUP_CLASSES}>
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          {t.common.cancel}
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!isComplete || isPending}
          loading={isPending}
          loadingLabel={pendingLabel ?? t.common.saving}
          aria-describedby={showHint ? hintId : undefined}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
