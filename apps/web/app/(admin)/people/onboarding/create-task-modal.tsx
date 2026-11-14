'use client';

import { useState } from 'react';
import { Button, BUTTON_GROUP_CLASSES, Field, Modal, TextArea, TextInput } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { trpc } from '../../../../lib/trpc';

export function CreateTaskModal({ planId, phase, onClose }: { planId: string; phase: string; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [responsible, setResponsible] = useState('');
  const [dueDate, setDueDate] = useState('');
  const create = trpc.onboarding.createTask.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.onboarding.list.invalidate(), utils.onboarding.getDashboardKpis.invalidate()]);
      toast(t.onboarding.createTaskSuccess, { type: 'success' });
      onClose();
    },
    onError: (error) => toast(error.message, { type: 'error' }),
  });

  const submit = () => {
    const trimmedTitle = title.trim();
    const trimmedResponsible = responsible.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle || !trimmedResponsible || create.isPending) return;
    create.mutate({
      planId,
      title: trimmedTitle,
      // Shown under the title in "Mi Onboarding" (B-24): what the task means and what to do.
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      responsible: trimmedResponsible,
      phase,
      ...(dueDate ? { dueDate: new Date(`${dueDate}T12:00:00`) } : {}),
    });
  };

  const isComplete = title.trim().length > 0 && responsible.trim().length > 0;

  return (
    <Modal
      title={t.onboarding.createTaskTitle}
      onClose={onClose}
      dirty={(title.length > 0 || description.length > 0 || responsible.length > 0 || !!dueDate) && !create.isPending}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t.onboarding.taskTitleLabel} required>
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} disabled={create.isPending} />
        </Field>
        <Field label={t.onboarding.taskDescriptionLabel}>
          <TextArea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={2}
            disabled={create.isPending}
          />
        </Field>
        <Field label={t.onboarding.taskResponsibleLabel} required>
          <TextInput
            value={responsible}
            onChange={(event) => setResponsible(event.target.value)}
            maxLength={200}
            disabled={create.isPending}
          />
        </Field>
        <Field label={t.onboarding.taskDueDateLabel}>
          <TextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={create.isPending} />
        </Field>
        {!isComplete && <p className="text-callout text-secondary sm:text-right">{t.onboarding.createTaskHint}</p>}
        <div className={BUTTON_GROUP_CLASSES}>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={!isComplete || create.isPending} loading={create.isPending} loadingLabel={t.common.saving}>
            {t.onboarding.createTaskAction}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
