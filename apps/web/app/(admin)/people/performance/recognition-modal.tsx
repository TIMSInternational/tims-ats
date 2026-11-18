'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Field, Modal, Select, TextArea, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { PersonField } from './person-field';
import { ModalActions } from './modal-actions';

interface RecognitionModalProps {
  onClose: () => void;
}

const CATEGORY_KEYS = [
  { value: 'excellence', labelKey: 'badgeExcellence' },
  { value: 'top_performer', labelKey: 'badgeTopPerformer' },
  { value: 'teamwork', labelKey: 'badgeTeamwork' },
  { value: 'innovation', labelKey: 'badgeInnovation' },
  { value: 'leadership', labelKey: 'badgeLeadership' },
] as const;

const MAX_MESSAGE = 2000;

export function RecognitionModal({ onClose }: RecognitionModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [recipient, setRecipient] = useState<PickedUser | null>(null);
  const [category, setCategory] = useState<string>(CATEGORY_KEYS[0].value);
  const [message, setMessage] = useState('');

  const give = trpc.performance.giveRecognition.useMutation({
    onSuccess: () => {
      utils.performance.listRecognitions.invalidate();
      utils.performance.myRecognitions.invalidate();
      toast(t.performance.recognitionSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const trimmed = message.trim();
  const canSubmit = !!recipient && trimmed.length > 0 && !give.isPending;

  const onSubmit = () => {
    if (!recipient || !canSubmit) return;
    give.mutate({ toUserId: recipient.id, category, message: trimmed });
  };

  return (
    <Modal
      title={t.performance.giveRecognitionTitle}
      onClose={onClose}
      dirty={(!!recipient || message.length > 0) && !give.isPending}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={onSubmit}
          submitLabel={t.performance.submit}
          isComplete={!!recipient && trimmed.length > 0}
          isPending={give.isPending}
          pendingLabel={t.performance.sending}
          hint={t.performance.messageHint}
        />
      }
    >
      <div className="space-y-4">
        <PersonField label={t.performance.recipientLabel} value={recipient} onChange={setRecipient} disabled={give.isPending} required>
          {(inputId) => (
            <UserPicker
              purpose="colleague"
              inputId={inputId}
              onSelect={(_userId, user) => setRecipient(user)}
              disabled={give.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>

        <Field label={t.performance.categoryLabel}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} disabled={give.isPending}>
            {CATEGORY_KEYS.map((c) => (
              <option key={c.value} value={c.value}>
                {t.performance[c.labelKey]}
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
            disabled={give.isPending}
            className="resize-none"
          />
        </Field>
      </div>
    </Modal>
  );
}
