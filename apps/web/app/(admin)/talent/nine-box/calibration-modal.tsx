'use client';

import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';
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
    <Modal title={`${t.committee.committeeTitle} · ${period}`} onClose={onClose}>
      <CommitteeMembersPanel sessionId={sessionId} />
      <div className="flex justify-end mt-5">
        <button
          onClick={onClose}
          className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition"
        >
          {t.committee.close}
        </button>
      </div>
    </Modal>
  );
}
