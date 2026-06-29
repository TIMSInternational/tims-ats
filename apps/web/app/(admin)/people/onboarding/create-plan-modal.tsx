'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';

interface CreatePlanModalProps {
  onClose: () => void;
}

const PHASE_VALUES = ['day1_30', 'day31_60', 'day61_90'] as const;
type PhaseValue = (typeof PHASE_VALUES)[number];

function phaseLabel(value: PhaseValue, t: ReturnType<typeof useI18n>['t']): string {
  if (value === 'day1_30') return t.onboarding.phaseDay1_30;
  if (value === 'day31_60') return t.onboarding.phaseDay31_60;
  return t.onboarding.phaseDay61_90;
}

export function CreatePlanModal({ onClose }: CreatePlanModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [newHire, setNewHire] = useState<PickedUser | null>(null);
  const [buddy, setBuddy] = useState<PickedUser | null>(null);
  const [startDate, setStartDate] = useState('');
  const [phase, setPhase] = useState<PhaseValue>('day1_30');

  const submit = trpc.onboarding.create.useMutation({
    onSuccess: () => {
      utils.onboarding.list.invalidate();
      utils.onboarding.getDashboardKpis.invalidate();
      toast(t.onboarding.createPlanSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canSubmit = !!newHire && !!startDate && !submit.isPending;

  const onSubmit = () => {
    if (!canSubmit || !newHire) return;
    submit.mutate({
      userId: newHire.id,
      buddyId: buddy?.id,
      startDate: new Date(startDate),
      phase,
    });
  };

  return (
    <Modal title={t.onboarding.createPlanTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* New hire */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.onboarding.newHireLabel}
          </label>
          {newHire ? (
            <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
              <span className="text-[12px] text-[#333] font-medium">
                {newHire.firstName} {newHire.lastName}
              </span>
              <button
                type="button"
                onClick={() => setNewHire(null)}
                disabled={submit.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              onSelect={(_userId, user) => setNewHire(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        {/* Buddy (optional) */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.onboarding.buddyLabel}
          </label>
          {buddy ? (
            <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
              <span className="text-[12px] text-[#333] font-medium">
                {buddy.firstName} {buddy.lastName}
              </span>
              <button
                type="button"
                onClick={() => setBuddy(null)}
                disabled={submit.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              onSelect={(_userId, user) => setBuddy(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        {/* Start date */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.onboarding.startDateLabel}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        {/* Phase */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.onboarding.phaseLabel}
          </label>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as PhaseValue)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          >
            {PHASE_VALUES.map((v) => (
              <option key={v} value={v}>
                {phaseLabel(v, t)}
              </option>
            ))}
          </select>
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
            {submit.isPending ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>
    </Modal>
  );
}
