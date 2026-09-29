'use client';

import { useState } from 'react';
import { Modal } from '../../../components';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

export function CreateCourseModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('online');
  const [category, setCategory] = useState('');
  const [duration, setDuration] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = trpc.learning.createCourse.useMutation();
  const durationValue = Number(duration);
  const isValid = title.trim().length > 0 && title.length <= 255 && Number.isInteger(durationValue) && durationValue > 0;

  const onSubmit = async () => {
    if (!isValid) return;
    setError(null);
    try {
      await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        category: category.trim() || undefined,
        duration: durationValue,
        isRequired,
      });
      await Promise.all([utils.learning.listCourses.invalidate(), utils.learning.getDashboardKpis.invalidate()]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.common.error);
    }
  };

  return (
    <Modal title={t.learning.newCourse} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.learning.courseTitle}
          <input type="text" maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
        </label>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.learning.courseDescription}
          <textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.learning.courseType}
            <select value={type} onChange={(event) => setType(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]">
              <option value="online">{t.learning.typeOnline}</option>
              <option value="in_person">{t.learning.typeInPerson}</option>
              <option value="hybrid">{t.learning.typeHybrid}</option>
            </select>
          </label>
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.learning.durationHours}
            <input type="number" min="1" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
          </label>
        </div>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.learning.courseCategory}
          <input type="text" maxLength={100} value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
        </label>
        <label className="flex items-center gap-2 text-[12px] font-medium text-[#585858]">
          <input type="checkbox" checked={isRequired} onChange={(event) => setIsRequired(event.target.checked)} />
          {t.learning.filterRequired}
        </label>
        {error && <p role="alert" className="text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={create.isPending} className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]">{t.common.cancel}</button>
          <button type="button" onClick={onSubmit} disabled={!isValid || create.isPending} className="rounded-lg bg-[#DD0C15] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t.common.create}</button>
        </div>
      </div>
    </Modal>
  );
}
