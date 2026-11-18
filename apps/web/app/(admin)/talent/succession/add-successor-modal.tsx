'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import {
  Button,
  BUTTON_GROUP_CLASSES,
  DialogCancelButton,
  Field,
  FIELD_LABEL_CLASSES,
  Modal,
  Select,
  TextArea,
  UserPicker,
} from '../../../../components';
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

  const dirty =
    !submit.isPending && (developmentPlan.trim().length > 0 || (!!candidate && candidate !== initialCandidate));

  return (
    <Modal
      title={t.succession.addSuccessorTitle}
      onClose={onClose}
      dirty={dirty}
      footer={
        <div className={BUTTON_GROUP_CLASSES}>
          <DialogCancelButton onCancel={onClose} disabled={submit.isPending} />
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            loading={submit.isPending}
            loadingLabel={t.succession.adding}
          >
            {t.succession.addSuccessor}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t.succession.roleLabel} required>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={submit.isPending}>
            <option value="" disabled>
              {t.succession.selectRolePlaceholder}
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </Select>
        </Field>

        {candidate ? (
          <div>
            <p className={FIELD_LABEL_CLASSES}>{t.succession.candidateLabel}</p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className="text-body font-medium text-primary">
                {candidate.firstName} {candidate.lastName}
              </span>
              <Button variant="tertiary" size="sm" onClick={() => setCandidate(null)} disabled={submit.isPending}>
                {t.succession.changeCandidate}
              </Button>
            </div>
          </div>
        ) : (
          <Field label={t.succession.candidateLabel} required>
            {(control) => (
              <UserPicker
                purpose="succession_candidate"
                inputId={control.id}
                onSelect={(_userId, user) => setCandidate(user)}
                disabled={submit.isPending}
                searchPlaceholder={t.committee.searchUser}
                loadingLabel={t.committee.loadingUsers}
                emptyLabel={t.committee.noUsers}
              />
            )}
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.succession.readinessLabel}>
            <Select
              value={readiness}
              onChange={(e) => setReadiness(e.target.value as (typeof READINESS_KEYS)[number]['value'])}
              disabled={submit.isPending}
            >
              {READINESS_KEYS.map((r) => (
                <option key={r.value} value={r.value}>
                  {t.succession[r.labelKey]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t.succession.successorTypeLabel}>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as (typeof TYPE_KEYS)[number]['value'])}
              disabled={submit.isPending}
            >
              {TYPE_KEYS.map((ty) => (
                <option key={ty.value} value={ty.value}>
                  {t.succession[ty.labelKey]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t.succession.developmentPlanLabel} optional help={`${developmentPlan.length}/1000`}>
          <TextArea
            value={developmentPlan}
            onChange={(e) => setDevelopmentPlan(e.target.value.slice(0, 1000))}
            maxLength={1000}
            rows={3}
            disabled={submit.isPending}
            className="resize-none"
          />
        </Field>
      </div>
    </Modal>
  );
}
