'use client';

import { useI18n } from '../../../../lib/i18n';
import { FIELD_LABEL_CLASSES, SegmentedControl } from '../../../../components';

type RemotePolicy = 'onsite' | 'remote' | 'hybrid';
type Priority = 'low' | 'medium' | 'high' | 'urgent';

interface VacancyChoiceGroupsProps {
  /** '' = a legacy vacancy saved without a modality: no segment is pressed until one is chosen. */
  remotePolicy: RemotePolicy | '';
  onRemotePolicyChange: (value: RemotePolicy) => void;
  priority: Priority;
  onPriorityChange: (value: Priority) => void;
}

/**
 * "Modalidad de trabajo" and "Prioridad" as named groups of pressed/unpressed segments, the same in the create
 * wizard and the "Editar" drawer (accessibility.md › Cognitive: consistent interactions). Every option stays navy
 * when selected — the word "Urgente" carries the urgency, not a red fill.
 */
export function VacancyChoiceGroups({
  remotePolicy,
  onRemotePolicyChange,
  priority,
  onPriorityChange,
}: VacancyChoiceGroupsProps) {
  const { t } = useI18n();
  const modalityOptions = [
    { value: 'onsite', label: t.vacancies.onsite },
    { value: 'hybrid', label: t.vacancies.hybrid },
    { value: 'remote', label: t.vacancies.remote },
  ] as const;
  const priorityOptions = [
    { value: 'low', label: t.vacancies.priorityLow },
    { value: 'medium', label: t.vacancies.priorityMedium },
    { value: 'high', label: t.vacancies.priorityHigh },
    { value: 'urgent', label: t.vacancies.priorityUrgent },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <p className={FIELD_LABEL_CLASSES} aria-hidden="true">
          {t.vacancies.workModality}
        </p>
        <SegmentedControl<RemotePolicy | ''>
          label={t.vacancies.workModality}
          options={modalityOptions}
          value={remotePolicy}
          onChange={(value) => {
            if (value !== '') onRemotePolicyChange(value);
          }}
          fullWidth
        />
      </div>
      <div>
        <p className={FIELD_LABEL_CLASSES} aria-hidden="true">
          {t.vacancies.priority}
        </p>
        <SegmentedControl<Priority>
          label={t.vacancies.priority}
          options={priorityOptions}
          value={priority}
          onChange={onPriorityChange}
          fullWidth
        />
      </div>
    </div>
  );
}
