'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';

interface LogCoachingModalProps {
  onClose: () => void;
}

export function LogCoachingModal({ onClose }: LogCoachingModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [employee, setEmployee] = useState<PickedUser | null>(null);
  const [coach, setCoach] = useState<PickedUser | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState('');

  const submit = trpc.performance.createCoachingSession.useMutation({
    onSuccess: () => {
      utils.performance.listCoachingSessions.invalidate();
      utils.performance.getDashboardKpis.invalidate();
      toast(t.performance.logCoachingSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const canSubmit =
    !!employee && !!coach && !!scheduledAt && topic.trim().length > 0 && !submit.isPending;

  const onSubmit = () => {
    if (!employee || !coach || !canSubmit) return;
    submit.mutate({
      employeeId: employee.id,
      leaderId: coach.id,
      scheduledAt: new Date(scheduledAt),
      topic: topic.trim(),
      ...(duration ? { duration: Number(duration) } : {}),
    });
  };

  return (
    <Modal title={t.performance.logCoachingTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Employee */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.employeeLabel}
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
                {t.performance.cancel}
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

        {/* Leader / Coach */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.coachLabel}
          </label>
          {coach ? (
            <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
              <span className="text-[12px] text-[#333] font-medium">
                {coach.firstName} {coach.lastName}
              </span>
              <button
                type="button"
                onClick={() => setCoach(null)}
                disabled={submit.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.performance.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              excludeIds={employee ? [employee.id] : []}
              onSelect={(_userId, user) => setCoach(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        {/* Scheduled At */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.dateLabel}
          </label>
          <input
            type="date"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        {/* Topic */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.topicLabel}
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value.slice(0, 500))}
            placeholder={t.performance.topicPlaceholder}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        {/* Duration (optional) */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.performance.durationLabel}
          </label>
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
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
