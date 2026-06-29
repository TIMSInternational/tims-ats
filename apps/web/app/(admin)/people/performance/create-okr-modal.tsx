'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';

interface KeyResultRow {
  title: string;
  targetValue: string;
}

interface CreateOkrModalProps {
  onClose: () => void;
}

export function CreateOkrModal({ onClose }: CreateOkrModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [title, setTitle] = useState('');
  const [period, setPeriod] = useState('');
  const [keyResults, setKeyResults] = useState<KeyResultRow[]>([{ title: '', targetValue: '' }]);

  const submit = trpc.performance.createOkr.useMutation({
    onSuccess: () => {
      utils.performance.listOkrs.invalidate();
      utils.performance.getDashboardKpis.invalidate();
      toast(t.performance.createOkrSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const canSubmit = !!owner && title.trim().length > 0 && period.trim().length > 0 && !submit.isPending;

  const onSubmit = () => {
    if (!owner || !canSubmit) return;
    const filteredKrs = keyResults
      .filter((kr) => kr.title.trim().length > 0)
      .map((kr) => ({ title: kr.title.trim(), targetValue: Number(kr.targetValue) || 0 }));
    submit.mutate({
      userId: owner.id,
      title: title.trim(),
      period: period.trim(),
      ...(filteredKrs.length > 0 ? { keyResults: filteredKrs } : {}),
    });
  };

  const addKeyResult = () => setKeyResults((prev) => [...prev, { title: '', targetValue: '' }]);

  const updateKr = (idx: number, field: keyof KeyResultRow, value: string) => {
    setKeyResults((prev) => prev.map((kr, i) => (i === idx ? { ...kr, [field]: value } : kr)));
  };

  return (
    <Modal title={t.performance.createOkrTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Owner */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.ownerLabel}
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

        {/* Objective title */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.objectiveLabel}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 500))}
            placeholder={t.performance.objectivePlaceholder}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        {/* Period */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.periodLabel}
          </label>
          <input
            type="text"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder={t.performance.periodPlaceholder}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        {/* Key Results */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.keyResultsLabel}
          </label>
          <div className="space-y-2">
            {keyResults.map((kr, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  value={kr.title}
                  onChange={(e) => updateKr(idx, 'title', e.target.value.slice(0, 500))}
                  placeholder={t.performance.krTitlePlaceholder}
                  disabled={submit.isPending}
                  className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
                />
                <input
                  type="number"
                  value={kr.targetValue}
                  onChange={(e) => updateKr(idx, 'targetValue', e.target.value)}
                  placeholder={t.performance.krTargetPlaceholder}
                  disabled={submit.isPending}
                  className="w-24 border border-[#EDEDED] rounded-lg px-3 py-2 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addKeyResult}
            disabled={submit.isPending}
            className="mt-2 text-[12px] text-[#1F114C] hover:underline disabled:opacity-50"
          >
            + {t.performance.addKeyResult}
          </button>
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
