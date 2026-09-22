'use client';

import { useState } from 'react';
import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { trpc } from '../../../../lib/trpc';

export function CompleteCheckInModal({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [notes, setNotes] = useState('');
  const [score, setScore] = useState('');
  const complete = trpc.onboarding.completeCheckIn.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.onboarding.list.invalidate(), utils.onboarding.getDashboardKpis.invalidate()]);
      toast(t.onboarding.checkInCompleted, { type: 'success' });
      onClose();
    },
    onError: (error) => toast(error.message, { type: 'error' }),
  });

  return (
    <Modal title={t.onboarding.completeCheckInTitle} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        complete.mutate({ id, ...(notes.trim() ? { notes: notes.trim() } : {}), ...(score ? { score: Number(score) } : {}) });
      }}>
        <p className="text-[13px] text-[#585858]">{label}</p>
        <label className="block text-[12px] font-medium text-[#333]">
          {t.onboarding.checkInNotes}
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={20000} rows={3} disabled={complete.isPending} className="mt-1 w-full rounded-lg border border-[#EDEDED] px-3 py-2 text-[13px]" />
        </label>
        <label className="block text-[12px] font-medium text-[#333]">
          {t.onboarding.checkInScore}
          <select value={score} onChange={(event) => setScore(event.target.value)} disabled={complete.isPending} className="mt-1 w-full rounded-lg border border-[#EDEDED] px-3 py-2 text-[13px]">
            <option value="">—</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={complete.isPending} className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]">{t.common.cancel}</button>
          <button type="submit" disabled={complete.isPending} className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t.onboarding.completeCheckInTitle}</button>
        </div>
      </form>
    </Modal>
  );
}
