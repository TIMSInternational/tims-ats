'use client';

import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { Modal, UserPicker } from '../../../components';
import type { PickedUser } from '../../../components/user-picker';

interface EnrollModalProps {
  courseId: string;
  courseTitle: string;
  onClose: () => void;
}

export function EnrollModal({ courseId, courseTitle, onClose }: EnrollModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [employee, setEmployee] = useState<PickedUser | null>(null);

  const submit = trpc.learning.enrollUser.useMutation({
    onSuccess: () => {
      utils.learning.listCourses.invalidate();
      utils.learning.getDashboardKpis.invalidate();
      toast(t.learning.enrollSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canSubmit = !!employee && !submit.isPending;

  const onSubmit = () => {
    if (!canSubmit || !employee) return;
    submit.mutate({ userId: employee.id, courseId });
  };

  return (
    <Modal title={t.learning.enrollTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Course (read-only) */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.learning.courseLabel}
          </label>
          <div className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-[#F6F6F6]">
            {courseTitle}
          </div>
        </div>

        {/* Employee picker */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.learning.employeeLabel}
          </label>
          {employee ? (
            <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
              <span className="text-[12px] text-[#333] font-medium">
                {employee.firstName} {employee.lastName}
              </span>
              <button
                type="button"
                onClick={() => setEmployee(null)}
                disabled={submit.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              onSelect={(_userId, user) => setEmployee(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submit.isPending}
            className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submit.isPending ? t.common.saving : t.learning.enrollAction}
          </button>
        </div>
      </div>
    </Modal>
  );
}
