'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Modal, UserPicker } from '../../../../../components';
import type { PickedUser } from '../../../../../components/user-picker';

interface SubmitApprovalModalProps {
  onConfirm: (approverIds: string[]) => void;
  onClose: () => void;
  isPending: boolean;
}

export function SubmitApprovalModal({ onConfirm, onClose, isPending }: SubmitApprovalModalProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<PickedUser[]>([]);

  const addApprover = (userId: string, user: PickedUser) => {
    if (selected.some((u) => u.id === userId)) return;
    if (selected.length >= 10) return;
    setSelected((prev) => [...prev, user]);
  };

  const removeApprover = (userId: string) => {
    setSelected((prev) => prev.filter((u) => u.id !== userId));
  };

  return (
    <Modal title={t.vacancies.submitForApproval} onClose={onClose}>
      <p className="text-xs text-[#8B8B8B] mb-4">{t.vacancies.selectApprovers}</p>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {selected.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 bg-[#F6F6F6] text-[#333] text-[12px] px-2.5 py-1 rounded-full"
            >
              {u.firstName} {u.lastName}
              <button
                type="button"
                onClick={() => removeApprover(u.id)}
                className="text-[#8B8B8B] hover:text-[#DD0C15]"
                aria-label={t.vacancies.removeApprover}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <UserPicker
        excludeIds={selected.map((u) => u.id)}
        onSelect={addApprover}
        disabled={isPending}
        searchPlaceholder={t.vacancies.searchApprovers}
        loadingLabel={t.vacancies.loadingApprovers}
        emptyLabel={t.vacancies.noApproversFound}
      />

      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={onClose}
          className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition"
        >
          {t.common.cancel}
        </button>
        <button
          onClick={() => onConfirm(selected.map((u) => u.id))}
          disabled={selected.length === 0 || isPending}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.vacancies.submitForApproval}
        </button>
      </div>
    </Modal>
  );
}
