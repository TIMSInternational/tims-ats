'use client';

import { useState } from 'react';
import { CHOICE_INPUT_CLASSES, CHOICE_ROW_CLASSES, Field, Modal, TextArea, TextInput } from '../../../components';
import { ModalActions } from '../people/performance/modal-actions';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

export function CreatePathModal({
  courses,
  onClose,
}: {
  courses: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = trpc.learning.createPath.useMutation();

  const submit = async () => {
    if (!name.trim() || courseIds.length === 0) return;
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined, courseIds });
      await utils.learning.listPaths.invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? `${t.learning.createPathError} ${cause.message}` : t.learning.createPathError);
    }
  };

  return (
    <Modal
      title={t.learning.createPath}
      onClose={onClose}
      dirty={(name.length > 0 || description.length > 0 || courseIds.length > 0) && !create.isPending}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={submit}
          submitLabel={t.learning.createPathAction}
          isComplete={name.trim().length > 0 && courseIds.length > 0}
          isPending={create.isPending}
          hint={t.learning.createPathHint}
        />
      }
    >
      <div className="space-y-4">
        <Field label={t.learning.pathName} required>
          <TextInput maxLength={255} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t.learning.courseDescription} optional>
          <TextArea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <fieldset className="max-h-52 overflow-y-auto rounded-lg border border-border p-3">
          <legend className="px-1 text-body font-medium text-primary">
            {t.learning.pathCourses}
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          </legend>
          {courses.map((course) => (
            <label key={course.id} className={CHOICE_ROW_CLASSES}>
              <input
                type="checkbox"
                className={CHOICE_INPUT_CLASSES}
                checked={courseIds.includes(course.id)}
                onChange={(event) =>
                  setCourseIds((current) =>
                    event.target.checked ? [...current, course.id] : current.filter((id) => id !== course.id),
                  )
                }
              />
              {course.title}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-callout text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
