'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { useSuccessionAddSuccessor } from '../../../../lib/platform-api/succession';

interface AddSuccessorModalProps {
  roles: { id: string; title: string }[];
  onClose: () => void;
  /**
   * Optional pre-fill (e.g. from the "Suggested Successors" Nine Box panel).
   * The form still opens for the human to review/edit before confirming
   * submit — nothing is auto-submitted.
   */
  initialRoleId?: string;
  initialCandidate?: PickedUser | null;
  initialReadiness?: (typeof READINESS_KEYS)[number]['value'];
}

const READINESS_KEYS = [
  { value: 'ready_now', labelKey: 'readinessReadyNow' },
  { value: 'ready_1_year', labelKey: 'readinessReady1' },
  { value: 'ready_2_years', labelKey: 'readinessReady2' },
  { value: 'developing', labelKey: 'readinessDeveloping' },
] as const;

const TYPE_KEYS = [
  { value: 'internal', labelKey: 'typeInternal' },
  { value: 'external', labelKey: 'typeExternal' },
] as const;

export function AddSuccessorModal({
  roles,
  onClose,
  initialRoleId,
  initialCandidate,
  initialReadiness,
}: AddSuccessorModalProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [roleId, setRoleId] = useState(initialRoleId ?? '');
  const [candidate, setCandidate] = useState<PickedUser | null>(initialCandidate ?? null);
  const [readiness, setReadiness] = useState<(typeof READINESS_KEYS)[number]['value']>(initialReadiness ?? 'ready_now');
  const [type, setType] = useState<(typeof TYPE_KEYS)[number]['value']>('internal');
  const [developmentPlan, setDevelopmentPlan] = useState('');

  const submit = useSuccessionAddSuccessor({
    onSuccess: () => {
      // The TS tRPC succession reads have been deleted — the platform-api query keys are the
      // only read path left to invalidate.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
      toast(t.succession.addSuccessorSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canSubmit = !!roleId && !!candidate && !submit.isPending;

  const onSubmit = () => {
    if (!canSubmit || !candidate) return;
    submit.mutate({
      criticalRoleId: roleId,
      userId: candidate.id,
      readiness,
      type,
      developmentPlan: developmentPlan.trim() || undefined,
    });
  };

  return (
    <Modal title={t.succession.addSuccessorTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Critical Role */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.succession.roleLabel}</label>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          >
            <option value="" disabled>
              {t.succession.selectRolePlaceholder}
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>

        {/* Candidate */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.succession.candidateLabel}</label>
          {candidate ? (
            <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
              <span className="text-[12px] text-[#333] font-medium">
                {candidate.firstName} {candidate.lastName}
              </span>
              <button
                type="button"
                onClick={() => setCandidate(null)}
                disabled={submit.isPending}
                className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <UserPicker
              onSelect={(_userId, user) => setCandidate(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </div>

        {/* Readiness */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.succession.readinessLabel}</label>
          <select
            value={readiness}
            onChange={(e) => setReadiness(e.target.value as (typeof READINESS_KEYS)[number]['value'])}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          >
            {READINESS_KEYS.map((r) => (
              <option key={r.value} value={r.value}>
                {t.succession[r.labelKey]}
              </option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.succession.successorTypeLabel}</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as (typeof TYPE_KEYS)[number]['value'])}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          >
            {TYPE_KEYS.map((ty) => (
              <option key={ty.value} value={ty.value}>
                {t.succession[ty.labelKey]}
              </option>
            ))}
          </select>
        </div>

        {/* Development Plan */}
        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">
            {t.succession.developmentPlanLabel}
          </label>
          <textarea
            value={developmentPlan}
            onChange={(e) => setDevelopmentPlan(e.target.value.slice(0, 1000))}
            maxLength={1000}
            rows={3}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8B8B8B] text-right mt-1">{developmentPlan.length}/1000</p>
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
