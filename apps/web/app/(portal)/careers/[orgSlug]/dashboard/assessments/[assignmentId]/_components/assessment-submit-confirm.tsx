'use client';

import { useI18n } from '../../../../../../../../lib/i18n';
import { formatMessage } from '../../../../../../../../lib/i18n/format';
import { Button, Modal, TEXT_LINK_CLASSES } from '../../../../../../../../components';

interface AssessmentSubmitConfirmProps {
  unansweredOrders: number[];
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Close the dialog and go to that question (its displayed number). */
  onJumpTo?: (order: number) => void;
}

// The shared dialog (focus trap, Escape = keep answering, focus returns to "Revisar y enviar"; modality.md). Focus
// starts on the safe button. Unanswered questions are links back to each one, not a bare list of numbers.
export function AssessmentSubmitConfirm({
  unansweredOrders,
  isSubmitting,
  onConfirm,
  onCancel,
  onJumpTo,
}: AssessmentSubmitConfirmProps) {
  const { t } = useI18n();
  const p = t.assessmentPlayer;

  return (
    <Modal
      title={p.submitConfirmTitle}
      size="sm"
      onClose={isSubmitting ? () => undefined : onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting} data-autofocus>
            {p.submitConfirmCancelButton}
          </Button>
          <Button onClick={onConfirm} loading={isSubmitting} loadingLabel={p.submitConfirmSubmitting}>
            {p.submitConfirmConfirmButton}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {unansweredOrders.length > 0 && (
          <div className="rounded-lg bg-warning-bg p-3 text-body text-warning">
            <p className="font-medium">{p.submitConfirmUnansweredPrefix}</p>
            <ul className="mt-1 flex flex-wrap gap-x-3">
              {unansweredOrders.map((order) => (
                <li key={order}>
                  {onJumpTo ? (
                    <button type="button" onClick={() => onJumpTo(order)} className={`${TEXT_LINK_CLASSES} underline`}>
                      {formatMessage(p.questionNumber, { n: order })}
                    </button>
                  ) : (
                    formatMessage(p.questionNumber, { n: order })
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-body text-secondary">{p.submitConfirmBody}</p>
      </div>
    </Modal>
  );
}
