'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import {
  BUTTON_GROUP_CLASSES,
  Button,
  FIELD_LABEL_CLASSES,
  Modal,
  inputClasses,
  textareaClasses,
} from '../../../../components';
import {
  ASSESSMENT_TYPE_DESCRIPTION_MAX,
  ASSESSMENT_TYPE_DURATION_MAX,
  ASSESSMENT_TYPE_NAME_MAX,
  useCreateAssessmentType,
  useUpdateAssessmentType,
  type AssessmentTypeRow,
} from '../../../../lib/platform-api/assessment-types';
import { assessmentTypeErrorMessage } from './assessment-type-error';

export interface EditableAssessmentType {
  id: string;
  name: string;
  description: string | null;
  duration: number | null;
}

interface AssessmentTypeModalProps {
  /** null → create; otherwise edit this type. */
  type: EditableAssessmentType | null;
  onClose: () => void;
  onSaved: (row: AssessmentTypeRow) => void;
}

const inputClass = inputClasses();
const labelClass = FIELD_LABEL_CLASSES;

export function AssessmentTypeModal({ type, onClose, onSaved }: AssessmentTypeModalProps) {
  const { t } = useI18n();
  const copy = t.assessments.typeAuthoring;
  const isEdit = type !== null;
  const [name, setName] = useState(type?.name ?? '');
  const [description, setDescription] = useState(type?.description ?? '');
  const [duration, setDuration] = useState(type?.duration != null ? String(type.duration) : '');
  const [error, setError] = useState<string | null>(null);

  const createM = useCreateAssessmentType(copy.unavailable);
  const updateM = useUpdateAssessmentType(copy.unavailable);
  const pending = createM.isPending || updateM.isPending;

  const fail = (err: unknown) => {
    const message = assessmentTypeErrorMessage(err, {
      ...copy,
      // A 404 on CREATE can only mean the C# route is not mapped (flag off) — say so, not "type no longer exists".
      notFound: isEdit ? copy.notFound : copy.unavailable,
    });
    setError(message);
    toast(message, { type: 'error' });
  };

  const submit = () => {
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || trimmedName.length > ASSESSMENT_TYPE_NAME_MAX) {
      setError(copy.nameRequired);
      return;
    }
    const trimmedDuration = duration.trim();
    const parsedDuration = trimmedDuration === '' ? null : Number(trimmedDuration);
    if (
      parsedDuration !== null &&
      (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > ASSESSMENT_TYPE_DURATION_MAX)
    ) {
      setError(copy.durationInvalid);
      return;
    }
    const trimmedDescription = description.trim();
    const payload = {
      name: trimmedName,
      description: trimmedDescription === '' ? null : trimmedDescription,
      duration: parsedDuration,
    };

    if (isEdit) {
      updateM.mutate(
        { id: type.id, ...payload },
        {
          onSuccess: (row) => {
            toast(copy.updated, { type: 'success' });
            onSaved(row);
          },
          onError: fail,
        },
      );
      return;
    }
    createM.mutate(payload, {
      onSuccess: (row) => {
        toast(copy.created, { type: 'success' });
        onSaved(row);
      },
      onError: fail,
    });
  };

  return (
    <Modal title={isEdit ? copy.editTitle : copy.createTitle} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor="assessment-type-name" className={labelClass}>
            {copy.name}
          </label>
          <input
            id="assessment-type-name"
            value={name}
            maxLength={ASSESSMENT_TYPE_NAME_MAX}
            placeholder={copy.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="assessment-type-description" className={labelClass}>
            {copy.description}
          </label>
          <textarea
            id="assessment-type-description"
            value={description}
            maxLength={ASSESSMENT_TYPE_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={textareaClasses()}
          />
        </div>
        <div>
          <label htmlFor="assessment-type-duration" className={labelClass}>
            {copy.duration}
          </label>
          <input
            id="assessment-type-duration"
            type="number"
            inputMode="numeric"
            min={1}
            max={ASSESSMENT_TYPE_DURATION_MAX}
            step={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && (
          <p role="alert" className="text-callout text-danger">
            {error}
          </p>
        )}
        <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
          <Button variant="secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" loading={pending} loadingLabel={copy.saving}>
            {copy.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
