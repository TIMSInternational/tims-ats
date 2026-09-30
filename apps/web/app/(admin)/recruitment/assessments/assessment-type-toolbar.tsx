'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { usePermissions } from '../../../../lib/permissions';
import {
  isAssessmentTypeAuthoringEnabled,
  useDeactivateAssessmentType,
  type AssessmentTypeRow,
} from '../../../../lib/platform-api/assessment-types';
import { AssessmentTypeModal, type EditableAssessmentType } from './assessment-type-modal';
import { assessmentTypeErrorMessage } from './assessment-type-error';

interface AssessmentTypeToolbarProps {
  selected: EditableAssessmentType | null;
  /** Called after any successful create/update/deactivate so the page refetches the type list. */
  onChanged: (row: AssessmentTypeRow) => void;
}

const secondaryButton =
  'h-9 px-3 rounded-lg border border-[#EDEDED] text-xs font-medium hover:bg-[#F5F5F5] disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * "Nuevo tipo de evaluación" + edit/deactivate for the selected type. Backed ONLY by the C# surface (F13); while
 * that is not enabled for this deployment the create button stays visible but disabled with an explanation, so the
 * empty state is never a dead end without a reason.
 */
export function AssessmentTypeToolbar({ selected, onChanged }: AssessmentTypeToolbarProps) {
  const { t } = useI18n();
  const copy = t.assessments.typeAuthoring;
  const { can } = usePermissions();
  const enabled = isAssessmentTypeAuthoringEnabled();
  const canCreate = can('assessment', 'create');
  const canUpdate = can('assessment', 'update');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const deactivateM = useDeactivateAssessmentType(copy.unavailable);

  if (!canCreate && !canUpdate) return null;

  const deactivate = () => {
    if (!selected || !window.confirm(copy.confirmDeactivate)) return;
    deactivateM.mutate(selected.id, {
      onSuccess: (row) => {
        toast(copy.deactivated, { type: 'success' });
        onChanged(row);
      },
      onError: (err) => toast(assessmentTypeErrorMessage(err, copy), { type: 'error' }),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canUpdate && selected && enabled && (
        <>
          <button type="button" onClick={() => setModal('edit')} className={`${secondaryButton} text-[#585858]`}>
            {copy.editType}
          </button>
          <button
            type="button"
            onClick={deactivate}
            disabled={deactivateM.isPending}
            className={`${secondaryButton} text-[#B42318]`}
          >
            {copy.deactivateType}
          </button>
        </>
      )}
      {canCreate && (
        <button
          type="button"
          onClick={() => setModal('create')}
          disabled={!enabled}
          title={enabled ? undefined : copy.unavailable}
          className={`${secondaryButton} text-[#1F114C]`}
        >
          {copy.newType}
        </button>
      )}
      {canCreate && !enabled && <p className="w-full text-xs text-[#8B8B8B]">{copy.unavailable}</p>}
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
