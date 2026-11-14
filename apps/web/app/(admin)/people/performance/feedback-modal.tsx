'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { CHOICE_INPUT_CLASSES, CHOICE_ROW_CLASSES, Field, Modal, Select, TextArea, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { PersonField } from './person-field';
import { ModalActions } from './modal-actions';

interface FeedbackModalProps {
  onClose: () => void;
}

const TYPE_KEYS = [
  { value: 'constructive', labelKey: 'typeConstructive' },
  { value: 'improvement', labelKey: 'typeImprovement' },
  { value: 'positive', labelKey: 'typePositive' },
] as const;

const MAX_MESSAGE = 2000;

export function FeedbackModal({ onClose }: FeedbackModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [recipient, setRecipient] = useState<PickedUser | null>(null);
  const [type, setType] = useState<string>(TYPE_KEYS[0].value);
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const submit = trpc.performance.submitFeedback.useMutation({
    onSuccess: () => {
      utils.performance.listFeedback.invalidate();
      toast(t.performance.feedbackSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const trimmed = message.trim();
  const canSubmit = !!recipient && trimmed.length > 0 && !submit.isPending;

  const onSubmit = () => {
    if (!recipient || !canSubmit) return;
    submit.mutate({ toUserId: recipient.id, type, message: trimmed, isAnonymous });
  };

  return (
    <Modal
      title={t.performance.giveFeedbackTitle}
      onClose={onClose}
      dirty={(!!recipient || message.length > 0) && !submit.isPending}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={onSubmit}
          submitLabel={t.performance.submit}
          isComplete={!!recipient && trimmed.length > 0}
          isPending={submit.isPending}
          pendingLabel={t.performance.sending}
          hint={t.performance.messageHint}
        />
      }
    >
      <div className="space-y-4">
        <PersonField label={t.performance.recipientLabel} value={recipient} onChange={setRecipient} disabled={submit.isPending} required>
          {(inputId) => (
            <UserPicker
              purpose="colleague"
              inputId={inputId}
              onSelect={(_userId, user) => setRecipient(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>

        <Field label={t.performance.feedbackTypeLabel}>
          <Select value={type} onChange={(e) => setType(e.target.value)} disabled={submit.isPending}>
            {TYPE_KEYS.map((ty) => (
              <option key={ty.value} value={ty.value}>
                {t.performance[ty.labelKey]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t.performance.messageLabel}
          required
          help={formatMessage(t.performance.charCount, { n: message.length, max: MAX_MESSAGE })}
        >
          <TextArea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
            maxLength={MAX_MESSAGE}
            rows={4}
            placeholder={t.performance.messagePlaceholder}
            disabled={submit.isPending}
            className="resize-none"
          />
        </Field>

        <label className={CHOICE_ROW_CLASSES}>
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
            disabled={submit.isPending}
            className={CHOICE_INPUT_CLASSES}
          />
          {t.performance.anonymousLabel}
        </label>
      </div>
    </Modal>
  );
}
