'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';

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
    if (!recipient || trimmed.length === 0) return;
    submit.mutate({ toUserId: recipient.id, type, message: trimmed, isAnonymous });
  };

  return (
    <Modal title={t.performance.giveFeedbackTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Recipient */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.recipientLabel}
          </label>
          {recipient ? (
            <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
              <span className="text-[12px] text-[#333] font-medium">
                {recipient.firstName} {recipient.lastName}
              </span>
              <button
                type="button"
                onClick={() => setRecipient(null)}
                disabled={submit.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.performance.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              onSelect={(_userId, user) => setRecipient(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        {/* Type */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.feedbackTypeLabel}
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          >
            {TYPE_KEYS.map((ty) => (
              <option key={ty.value} value={ty.value}>
                {t.performance[ty.labelKey]}
              </option>
            ))}
          </select>
        </div>

        {/* Message */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.messageLabel}
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
            maxLength={MAX_MESSAGE}
            rows={4}
            placeholder={t.performance.messagePlaceholder}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8B8B8B] text-right mt-1">
            {message.length}/{MAX_MESSAGE}
          </p>
        </div>

        {/* Anonymous */}
        <label className="flex items-center gap-2 text-[12px] text-[#585858] cursor-pointer">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
            disabled={submit.isPending}
            className="h-4 w-4 rounded border-[#EDEDED] text-[#DD0C15] focus:ring-[#1F114C]/40 disabled:opacity-50"
          />
          {t.performance.anonymousLabel}
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submit.isPending}
            className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-50"
          >
            {t.performance.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t.performance.submit}
          </button>
        </div>
      </div>
    </Modal>
  );
}
