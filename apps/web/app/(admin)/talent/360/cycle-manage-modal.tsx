'use client';

import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';
import { AssignRatersForm } from './assign-raters-form';
import { CycleProgressPanel } from './cycle-progress-panel';

interface CycleManageModalProps {
  cycleId: string;
  cycleName: string;
  onClose: () => void;
}

/** Wraps assign-raters + progress for ONE cycle behind a Modal, opened from
 * CycleRow's "Manage" button. */
export function CycleManageModal({ cycleId, cycleName, onClose }: CycleManageModalProps) {
  const { t } = useI18n();

  return (
    <Modal title={`${t.evaluation360.pageTitle} — ${cycleName}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-6">
        <AssignRatersForm cycleId={cycleId} />
        <div className="pt-4 border-t border-[#EDEDED]">
          <CycleProgressPanel cycleId={cycleId} />
        </div>
      </div>
    </Modal>
  );
}
