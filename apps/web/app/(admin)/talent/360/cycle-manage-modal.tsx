'use client';

import { useState } from 'react';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { Modal } from '../../../../components';
import { AssignRatersForm } from './assign-raters-form';
import { CycleProgressPanel } from './cycle-progress-panel';

interface CycleManageModalProps {
  cycleId: string;
  cycleName: string;
  onClose: () => void;
}

/** Wraps assign-raters + progress for ONE cycle behind a Modal, opened from
 * the row's "Gestionar evaluadores…" button. Unsaved rater rows ask before closing. */
export function CycleManageModal({ cycleId, cycleName, onClose }: CycleManageModalProps) {
  const { t } = useI18n();
  const [dirty, setDirty] = useState(false);

  return (
    <Modal
      title={formatMessage(t.evaluation360.manageModalTitle, { cycle: cycleName })}
      onClose={onClose}
      size="lg"
      dirty={dirty}
    >
      <div className="space-y-6">
        <AssignRatersForm cycleId={cycleId} onDirtyChange={setDirty} />
        <div className="pt-4 border-t border-border">
          <CycleProgressPanel cycleId={cycleId} />
        </div>
      </div>
    </Modal>
  );
}
