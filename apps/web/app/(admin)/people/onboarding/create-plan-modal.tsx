'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, Modal, Select, TextInput, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { PersonField } from '../performance/person-field';
import { ModalActions } from '../performance/modal-actions';

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
  // The optional buddy stays folded away until asked for (it can also be assigned later from the table).
  const [showBuddy, setShowBuddy] = useState(false);

  const submit = trpc.onboarding.create.useMutation({
    onSuccess: () => {
      utils.onboarding.list.invalidate();
      utils.onboarding.getDashboardKpis.invalidate();
      toast(t.onboarding.createPlanSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const isComplete = !!newHire && !!startDate;
  const canSubmit = isComplete && !submit.isPending;

  const onSubmit = () => {
    if (!canSubmit || !newHire) return;
    submit.mutate({
      userId: newHire.id,
      buddyId: buddy?.id,
      // Date-only fields represent a calendar day, not UTC midnight. Noon avoids
      // displaying the preceding day for users west of UTC.
      startDate: new Date(`${startDate}T12:00:00`),
      phase,
    });
  };

  return (
    <Modal
      title={t.onboarding.createPlanTitle}
      onClose={onClose}
      dirty={(!!newHire || !!buddy || !!startDate) && !submit.isPending}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={onSubmit}
          submitLabel={t.onboarding.createPlanAction}
          isComplete={isComplete}
          isPending={submit.isPending}
          hint={t.onboarding.createPlanHint}
        />
      }
    >
      <div className="space-y-4">
        <PersonField label={t.onboarding.newHireLabel} value={newHire} onChange={setNewHire} disabled={submit.isPending} required>
          {(inputId) => (
            <UserPicker
              purpose="onboarding_hire"
              inputId={inputId}
              listMode="onFocus"
              onSelect={(_userId, user) => setNewHire(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>

        <Field label={t.onboarding.startDateLabel} required>
          <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={submit.isPending} />
        </Field>

        <Field label={t.onboarding.phaseLabel}>
          <Select value={phase} onChange={(e) => setPhase(e.target.value as PhaseValue)} disabled={submit.isPending}>
            {PHASE_VALUES.map((v) => (
              <option key={v} value={v}>
                {phaseLabel(v, t)}
              </option>
            ))}
          </Select>
        </Field>

        {showBuddy || buddy ? (
          <PersonField label={t.onboarding.buddyFieldLabel} value={buddy} onChange={setBuddy} disabled={submit.isPending} optional>
            {(inputId) => (
              <UserPicker
                purpose="colleague"
                inputId={inputId}
                listMode="onFocus"
                onSelect={(_userId, user) => setBuddy(user)}
                disabled={submit.isPending}
                searchPlaceholder={t.committee.searchUser}
                loadingLabel={t.committee.loadingUsers}
                emptyLabel={t.committee.noUsers}
              />
            )}
          </PersonField>
        ) : (
          <Button variant="tertiary" size="sm" className="-ml-3" onClick={() => setShowBuddy(true)} disabled={submit.isPending}>
            + {t.onboarding.addBuddy}
          </Button>
        )}
      </div>
    </Modal>
  );
}
