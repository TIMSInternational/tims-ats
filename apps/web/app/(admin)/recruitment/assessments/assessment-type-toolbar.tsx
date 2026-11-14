'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { usePermissions } from '../../../../lib/permissions';
import {
  isAssessmentTypeAuthoringEnabled,
  useDeactivateAssessmentType,
  type AssessmentTypeRow,
} from '../../../../lib/platform-api/assessment-types';
import { Button, ConfirmDialog } from '../../../../components';
import { AssessmentTypeModal, type EditableAssessmentType } from './assessment-type-modal';
import { assessmentTypeErrorMessage } from './assessment-type-error';

interface AssessmentTypeToolbarProps {
  selected: EditableAssessmentType | null;
  /** Called after any successful create/update/deactivate so the page refetches the type list. */
  onChanged: (row: AssessmentTypeRow) => void;
  /** primary while there are no types yet: creating one is then the page's only way forward. */
  createVariant?: 'primary' | 'secondary';
}

/**
 * "Nuevo tipo de evaluación" + edit/deactivate for the selected type. Backed ONLY by the C# surface (F13); while
 * that is not enabled for this deployment the create button stays visible but disabled with an explanation, so the
 * empty state is never a dead end without a reason.
 */
export function AssessmentTypeToolbar({
  selected,
  onChanged,
  createVariant = 'secondary',
}: AssessmentTypeToolbarProps) {
  const { t } = useI18n();
  const copy = t.assessments.typeAuthoring;
  const { can } = usePermissions();
  const enabled = isAssessmentTypeAuthoringEnabled();
  const canCreate = can('assessment', 'create');
  const canUpdate = can('assessment', 'update');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const deactivateM = useDeactivateAssessmentType(copy.unavailable);

  if (!canCreate && !canUpdate) return null;

  const deactivate = () => {
    if (!selected) return;
    deactivateM.mutate(selected.id, {
      onSuccess: (row) => {
        setConfirming(false);
        toast(copy.deactivated, { type: 'success' });
        onChanged(row);
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canUpdate && selected && enabled && (
        <>
          <Button variant="secondary" size="sm" onClick={() => setModal('edit')}>
            {copy.editType}
          </Button>
          <Button variant="destructive-secondary" size="sm" onClick={() => setConfirming(true)}>
            {copy.deactivateType}
          </Button>
        </>
      )}
      {canCreate && (
        <Button
          variant={createVariant}
          size={createVariant === 'primary' ? 'md' : 'sm'}
          onClick={() => setModal('create')}
          disabled={!enabled}
          aria-describedby={enabled ? undefined : 'assessment-type-unavailable'}
        >
          {copy.newType}
        </Button>
      )}
      {canCreate && !enabled && (
        <p id="assessment-type-unavailable" className="w-full text-callout text-secondary">
          {copy.unavailable}
        </p>
      )}
      {confirming && selected && (
        <ConfirmDialog
          title={formatMessage(copy.deactivateConfirmTitle, { name: selected.name })}
          description={copy.deactivateConfirmBody}
          confirmLabel={copy.deactivateConfirm}
          confirmingLabel={copy.deactivating}
          destructive
          loading={deactivateM.isPending}
          error={deactivateM.error ? assessmentTypeErrorMessage(deactivateM.error, copy) : undefined}
          onConfirm={deactivate}
          onCancel={() => {
            setConfirming(false);
            deactivateM.reset();
          }}
        />
      )}
      {modal && (
        <AssessmentTypeModal
          type={modal === 'edit' ? selected : null}
          onClose={() => setModal(null)}
          onSaved={(row) => {
            setModal(null);
            onChanged(row);
          }}
        />
      )}
    </div>
  );
}
