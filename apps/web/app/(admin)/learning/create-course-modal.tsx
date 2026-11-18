'use client';

import { useState } from 'react';
import { CHOICE_INPUT_CLASSES, CHOICE_ROW_CLASSES, Field, Modal, Select, TextArea, TextInput } from '../../../components';
import { ModalActions } from '../people/performance/modal-actions';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { courseHoursToMinutes } from './course-duration';

export function CreateCourseModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('online');
  const [category, setCategory] = useState('');
  const [duration, setDuration] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = trpc.learning.createCourse.useMutation();
  const durationHours = Number(duration);
  const isDurationValid = duration !== '' && Number.isFinite(durationHours)
    && durationHours >= 0.25 && durationHours <= 168
    && Number.isInteger(durationHours * 4);
  const isValid = title.trim().length > 0 && title.length <= 255 && isDurationValid;
  // Show the 0.25 h rule as an inline error once the field has been left with a bad value.
  const [durationTouched, setDurationTouched] = useState(false);
  const durationError = durationTouched && duration !== '' && !isDurationValid ? t.learning.durationError : undefined;

  const onSubmit = async () => {
    if (!isValid) return;
    setError(null);
    try {
      await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        category: category.trim() || undefined,
        duration: courseHoursToMinutes(durationHours),
        isRequired,
      });
      await Promise.all([utils.learning.listCourses.invalidate(), utils.learning.getDashboardKpis.invalidate()]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? `${t.learning.createCourseError} ${cause.message}` : t.learning.createCourseError);
    }
  };

  return (
    <Modal
      title={t.learning.newCourseTitle}
      onClose={onClose}
      dirty={(title.length > 0 || description.length > 0 || duration.length > 0 || category.length > 0) && !create.isPending}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={onSubmit}
          submitLabel={t.learning.createCourseAction}
          isComplete={isValid}
          isPending={create.isPending}
          hint={t.learning.createCourseHint}
        />
      }
    >
      <div className="space-y-4">
        <Field label={t.learning.courseTitle} required>
          <TextInput maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label={t.learning.courseDescription} optional>
          <TextArea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t.learning.courseType}>
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="online">{t.learning.typeOnline}</option>
              <option value="in_person">{t.learning.typeInPerson}</option>
              <option value="hybrid">{t.learning.typeHybrid}</option>
            </Select>
          </Field>
          <Field label={t.learning.durationHours} required help={t.learning.durationHint} error={durationError}>
            <TextInput
              type="number"
              inputMode="decimal"
              min="0.25"
              max="168"
              step="0.25"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              onBlur={() => setDurationTouched(true)}
            />
          </Field>
        </div>
        <Field label={t.learning.courseCategory} optional>
          <TextInput maxLength={100} value={category} onChange={(event) => setCategory(event.target.value)} />
        </Field>
        <label className={CHOICE_ROW_CLASSES}>
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(event) => setIsRequired(event.target.checked)}
            className={CHOICE_INPUT_CLASSES}
          />
          {t.learning.requiredCourse}
        </label>
        {error && (
          <p role="alert" className="text-callout text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
