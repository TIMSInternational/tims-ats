'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, Modal, TextInput, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { PersonField } from './person-field';
import { ModalActions } from './modal-actions';

interface KeyResultRow {
  title: string;
  targetValue: string;
}

interface CreateOkrModalProps {
  onClose: () => void;
}

export function CreateOkrModal({ onClose }: CreateOkrModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [title, setTitle] = useState('');
  const [period, setPeriod] = useState('');
  const [keyResults, setKeyResults] = useState<KeyResultRow[]>([{ title: '', targetValue: '' }]);

  const submit = trpc.performance.createOkr.useMutation({
    onSuccess: () => {
      utils.performance.listOkrs.invalidate();
      utils.performance.getDashboardKpis.invalidate();
      toast(t.performance.createOkrSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const isComplete = !!owner && title.trim().length > 0 && period.trim().length > 0;
  const canSubmit = isComplete && !submit.isPending;
  const isDirty =
    !!owner || title.length > 0 || period.length > 0 || keyResults.some((kr) => kr.title || kr.targetValue);

  const onSubmit = () => {
    if (!owner || !canSubmit) return;
    const filteredKrs = keyResults
      .filter((kr) => kr.title.trim().length > 0)
      .map((kr) => ({ title: kr.title.trim(), targetValue: Number(kr.targetValue) || 0 }));
    submit.mutate({
      userId: owner.id,
      title: title.trim(),
      period: period.trim(),
      ...(filteredKrs.length > 0 ? { keyResults: filteredKrs } : {}),
    });
  };

  const addKeyResult = () => setKeyResults((prev) => [...prev, { title: '', targetValue: '' }]);

  const updateKr = (idx: number, field: keyof KeyResultRow, value: string) => {
    setKeyResults((prev) => prev.map((kr, i) => (i === idx ? { ...kr, [field]: value } : kr)));
  };

  const footer = (
    <ModalActions
      onCancel={onClose}
      onSubmit={onSubmit}
      submitLabel={t.performance.createOkrAction}
      isComplete={isComplete}
      isPending={submit.isPending}
      hint={t.performance.createOkrHint}
    />
  );

  return (
    <Modal title={t.performance.createOkrTitle} onClose={onClose} footer={footer} dirty={isDirty && !submit.isPending}>
      <div className="space-y-4">
        <PersonField
          label={t.performance.ownerLabel}
          value={owner}
          onChange={setOwner}
          disabled={submit.isPending}
          required
        >
          {(inputId) => (
            <UserPicker
              purpose="performance_subject"
              inputId={inputId}
              onSelect={(_userId, user) => setOwner(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>

        <Field label={t.performance.objectiveLabel} required>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 500))}
            placeholder={t.performance.objectivePlaceholder}
            disabled={submit.isPending}
          />
        </Field>

        <Field label={t.performance.periodLabel} required>
          <TextInput
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder={t.performance.periodPlaceholder}
            disabled={submit.isPending}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-body font-medium text-primary">
            {t.performance.keyResultsLabel} <span className="font-normal text-secondary">({t.common.optional})</span>
          </legend>
          <div className="space-y-2">
            {keyResults.map((kr, idx) => (
              <div key={idx} className="flex gap-2">
                <TextInput
                  value={kr.title}
                  onChange={(e) => updateKr(idx, 'title', e.target.value.slice(0, 500))}
                  placeholder={t.performance.krTitlePlaceholder}
                  aria-label={formatMessage(t.performance.krTitleAria, { n: idx + 1 })}
                  disabled={submit.isPending}
                  className="flex-1"
                />
                <TextInput
                  type="number"
                  inputMode="decimal"
                  value={kr.targetValue}
                  onChange={(e) => updateKr(idx, 'targetValue', e.target.value)}
                  placeholder={t.performance.krTargetPlaceholder}
                  aria-label={formatMessage(t.performance.krTargetAria, { n: idx + 1 })}
                  disabled={submit.isPending}
                  className="w-24! shrink-0"
                />
              </div>
            ))}
          </div>
          <Button
            variant="tertiary"
            size="sm"
            onClick={addKeyResult}
            disabled={submit.isPending}
            className="mt-2 -ml-3"
          >
            + {t.performance.addKeyResult}
          </Button>
        </fieldset>
      </div>
    </Modal>
  );
}
