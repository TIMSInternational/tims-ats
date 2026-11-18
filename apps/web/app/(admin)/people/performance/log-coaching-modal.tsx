'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Field, Modal, TextInput, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { PersonField } from './person-field';
import { ModalActions } from './modal-actions';

interface LogCoachingModalProps {
  onClose: () => void;
}

export function LogCoachingModal({ onClose }: LogCoachingModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [employee, setEmployee] = useState<PickedUser | null>(null);
  const [coach, setCoach] = useState<PickedUser | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState('');

  const submit = trpc.performance.createCoachingSession.useMutation({
    onSuccess: () => {
      utils.performance.listCoachingSessions.invalidate();
      utils.performance.getDashboardKpis.invalidate();
      toast(t.performance.logCoachingSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const isComplete = !!employee && !!coach && !!scheduledAt && topic.trim().length > 0;
  const canSubmit = isComplete && !submit.isPending;
  const isDirty = !!employee || !!coach || !!scheduledAt || topic.length > 0 || duration.length > 0;

  const onSubmit = () => {
    if (!employee || !coach || !canSubmit) return;
    submit.mutate({
      employeeId: employee.id,
      leaderId: coach.id,
      scheduledAt: new Date(scheduledAt),
      topic: topic.trim(),
      ...(duration ? { duration: Number(duration) } : {}),
    });
  };

  return (
    <Modal
      title={t.performance.logCoachingTitle}
      onClose={onClose}
      dirty={isDirty && !submit.isPending}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={onSubmit}
          submitLabel={t.performance.logCoachingAction}
          isComplete={isComplete}
          isPending={submit.isPending}
          hint={t.performance.logCoachingHint}
        />
      }
    >
      <div className="space-y-4">
        <PersonField
          label={t.performance.employeeLabel}
          value={employee}
          onChange={setEmployee}
          disabled={submit.isPending}
          required
        >
          {(inputId) => (
            <UserPicker
              purpose="performance_subject"
              inputId={inputId}
              listMode="onFocus"
              onSelect={(_userId, user) => setEmployee(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>

        <PersonField label={t.performance.coachLabel} value={coach} onChange={setCoach} disabled={submit.isPending} required>
          {(inputId) => (
            <UserPicker
              purpose="colleague"
              inputId={inputId}
              listMode="onFocus"
              autoFocus={false}
              excludeIds={employee ? [employee.id] : []}
              onSelect={(_userId, user) => setCoach(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>

        <Field label={t.performance.dateLabel} required>
          <TextInput
            type="date"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={submit.isPending}
          />
        </Field>

        <Field label={t.performance.topicLabel} required>
          <TextInput
            value={topic}
            onChange={(e) => setTopic(e.target.value.slice(0, 500))}
            placeholder={t.performance.topicPlaceholder}
            disabled={submit.isPending}
          />
        </Field>

        <Field label={t.performance.durationLabel} optional>
          <TextInput
            type="number"
            inputMode="numeric"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            disabled={submit.isPending}
          />
        </Field>
      </div>
    </Modal>
  );
}
