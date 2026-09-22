'use client';

import { useState } from 'react';
import { Modal } from '../../../components';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

export function CreatePathModal({
  courses,
  onClose,
}: {
  courses: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = trpc.learning.createPath.useMutation();

  const submit = async () => {
    if (!name.trim() || courseIds.length === 0) return;
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined, courseIds });
      await utils.learning.listPaths.invalidate();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.common.error);
    }
  };

  return (
    <Modal title={t.learning.createPath} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.learning.pathName}
          <input type="text" maxLength={255} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
        </label>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.learning.courseDescription}
          <textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
        </label>
        <fieldset className="max-h-52 overflow-y-auto rounded-lg border border-[#EDEDED] p-3">
          <legend className="px-1 text-[12px] font-medium text-[#585858]">{t.learning.courses}</legend>
          {courses.map((course) => (
            <label key={course.id} className="flex items-center gap-2 py-1 text-[12px] text-[#333]">
              <input type="checkbox" checked={courseIds.includes(course.id)} onChange={(event) => setCourseIds((current) => event.target.checked ? [...current, course.id] : current.filter((id) => id !== course.id))} />
              {course.title}
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={create.isPending} className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]">{t.common.cancel}</button>
          <button type="button" onClick={submit} disabled={!name.trim() || courseIds.length === 0 || create.isPending} className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t.common.create}</button>
        </div>
      </div>
    </Modal>
  );
}
