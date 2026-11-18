'use client';

import { Modal } from '../../../../components';
import { Button } from '../../../../components/button';
import { useI18n } from '../../../../lib/i18n';

// Confirmation step for "No se presentó" (A-02): closes a started interview nobody scored. No email is
// sent, so there is no reason field (unlike cancelling).
export function NoShowDialog({
  isPending,
  onConfirm,
  onClose,
}: {
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal
      title={t.interviews.noShowDialogTitle}
      description={t.interviews.noShowDialogBody}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.interviews.noShowDialogBack}
          </Button>
          <Button loading={isPending} onClick={onConfirm}>
            {t.interviews.noShowDialogConfirm}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}
