'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Field, Modal, TextArea, TextInput, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { PersonField } from './person-field';
import { ModalActions } from './modal-actions';

interface CreateCommitmentModalProps {
  onClose: () => void;
}

const MAX_DESC = 1000;

export function CreateCommitmentModal({ onClose }: CreateCommitmentModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const submit = trpc.performance.createCommitment.useMutation({
    onSuccess: () => {
      utils.performance.listCommitments.invalidate();
      utils.performance.myCommitments.invalidate();
      utils.performance.getDashboardKpis.invalidate();
      toast(t.performance.createCommitmentSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const isComplete = !!owner && description.trim().length > 0 && !!dueDate;
  const canSubmit = isComplete && !submit.isPending;

  const onSubmit = () => {
    if (!owner || !canSubmit) return;
    submit.mutate({
      employeeId: owner.id,
      description: description.trim(),
      dueDate: new Date(dueDate),
    });
  };

  return (
    <Modal
      title={t.performance.createCommitmentTitle}
      onClose={onClose}
      dirty={(!!owner || description.length > 0 || !!dueDate) && !submit.isPending}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={onSubmit}
          submitLabel={t.performance.createCommitmentAction}
          isComplete={isComplete}
          isPending={submit.isPending}
          hint={t.performance.createCommitmentHint}
        />
      }
    >
      <div className="space-y-4">
        <PersonField label={t.performance.employeeLabel} value={owner} onChange={setOwner} disabled={submit.isPending} required>
          {(inputId) => (
            <UserPicker
              purpose="performance_subject"
              inputId={inputId}
              onSelect={(_userId, user) => setOwner(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>

        <Field
          label={t.performance.descriptionLabel}
          required
          help={formatMessage(t.performance.charCount, { n: description.length, max: MAX_DESC })}
        >
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))}
            maxLength={MAX_DESC}
            rows={4}
            placeholder={t.performance.descriptionPlaceholder}
            disabled={submit.isPending}
            className="resize-none"
          />
        </Field>

        <Field label={t.performance.dueDateLabel} required>
          <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={submit.isPending} />
        </Field>
      </div>
    </Modal>
  );
}
