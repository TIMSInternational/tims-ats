'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button, Modal } from '../../../../components';
import { CommitteeMembersPanel } from './committee-members-panel';

interface CalibrationModalProps {
  sessionId: string;
  period: string;
  onClose: () => void;
}

/**
 * Wraps the committee-members manager for a single calibration session in a
 * Modal. Mounted by the nine-box page after a session is created/selected.
 */
export function CalibrationModal({ sessionId, period, onClose }: CalibrationModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      title={`${t.committee.committeeTitle} · ${period}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t.committee.close}
          </Button>
        </div>
      }
    >
      <CommitteeMembersPanel sessionId={sessionId} />
    </Modal>
  );
}
