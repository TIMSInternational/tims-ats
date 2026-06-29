'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';

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

  const canSubmit = !!owner && description.trim().length > 0 && !!dueDate && !submit.isPending;

  const onSubmit = () => {
    if (!owner || !canSubmit) return;
    submit.mutate({
      employeeId: owner.id,
      description: description.trim(),
      dueDate: new Date(dueDate),
    });
  };

  return (
    <Modal title={t.performance.createCommitmentTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Employee */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.employeeLabel}
          </label>
          {owner ? (
            <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
              <span className="text-[12px] text-[#333] font-medium">
                {owner.firstName} {owner.lastName}
              </span>
              <button
                type="button"
                onClick={() => setOwner(null)}
                disabled={submit.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.performance.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              onSelect={(_userId, user) => setOwner(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.descriptionLabel}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))}
            maxLength={MAX_DESC}
            rows={4}
            placeholder={t.performance.descriptionPlaceholder}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8B8B8B] text-right mt-1">
            {description.length}/{MAX_DESC}
          </p>
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.dueDateLabel}
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

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
            {submit.isPending ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>
    </Modal>
  );
}
