'use client';

import { useState } from 'react';
import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { trpc } from '../../../../lib/trpc';

export function CreateTaskModal({ planId, phase, onClose }: { planId: string; phase: string; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState('');
  const [responsible, setResponsible] = useState('');
  const [dueDate, setDueDate] = useState('');
  const create = trpc.onboarding.createTask.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.onboarding.list.invalidate(), utils.onboarding.getDashboardKpis.invalidate()]);
      toast(t.onboarding.createTaskSuccess, { type: 'success' });
      onClose();
    },
    onError: (error) => toast(error.message, { type: 'error' }),
  });

  const submit = () => {
    const trimmedTitle = title.trim();
    const trimmedResponsible = responsible.trim();
    if (!trimmedTitle || !trimmedResponsible || create.isPending) return;
    create.mutate({
      planId,
      title: trimmedTitle,
      responsible: trimmedResponsible,
      phase,
      ...(dueDate ? { dueDate: new Date(`${dueDate}T12:00:00`) } : {}),
    });
  };

  return (
    <Modal title={t.onboarding.createTaskTitle} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label className="block text-[12px] font-medium text-[#333]">
          {t.onboarding.taskTitleLabel}
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} required disabled={create.isPending} className="mt-1 w-full rounded-lg border border-[#EDEDED] px-3 py-2 text-[13px]" />
        </label>
        <label className="block text-[12px] font-medium text-[#333]">
          {t.onboarding.taskResponsibleLabel}
          <input value={responsible} onChange={(event) => setResponsible(event.target.value)} maxLength={200} required disabled={create.isPending} className="mt-1 w-full rounded-lg border border-[#EDEDED] px-3 py-2 text-[13px]" />
        </label>
        <label className="block text-[12px] font-medium text-[#333]">
          {t.onboarding.taskDueDateLabel}
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={create.isPending} className="mt-1 w-full rounded-lg border border-[#EDEDED] px-3 py-2 text-[13px]" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={create.isPending} className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]">{t.common.cancel}</button>
          <button type="submit" disabled={!title.trim() || !responsible.trim() || create.isPending} className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t.common.save}</button>
        </div>
      </form>
    </Modal>
  );
}
