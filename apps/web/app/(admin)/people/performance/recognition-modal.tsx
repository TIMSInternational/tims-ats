'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';

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
    if (!recipient || trimmed.length === 0) return;
    give.mutate({ toUserId: recipient.id, category, message: trimmed });
  };

  return (
    <Modal title={t.performance.giveRecognitionTitle} onClose={onClose}>
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
                disabled={give.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.performance.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              onSelect={(_userId, user) => setRecipient(user)}
              disabled={give.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        {/* Category */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.categoryLabel}
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={give.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          >
            {CATEGORY_KEYS.map((c) => (
              <option key={c.value} value={c.value}>
                {t.performance[c.labelKey]}
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
            disabled={give.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8B8B8B] text-right mt-1">
            {message.length}/{MAX_MESSAGE}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={give.isPending}
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
