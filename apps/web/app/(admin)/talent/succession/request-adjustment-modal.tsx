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
  Modal,
  TextArea,
  TextInput,
} from '../../../../components';
import { useCompensationCreateAdjustment } from '../../../../lib/platform-api/compensation';

interface RequestAdjustmentModalProps {
  userId: string;
  employeeName: string;
  previousSalary: number;
  suggestedNewSalary: number;
  onClose: () => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const MAX_REASON = 500;

/**
 * Sprint 1.4 Task 4 — the comp-gap badge's "Request adjustment" trigger.
 * This is small frontend wiring of the EXISTING, already-fully-built salary-adjustment
 * create endpoint (POST /compensation/adjustments on the C# Platform service, via
 * useCompensationCreateAdjustment; its TS tRPC counterpart `compensation.createAdjustment`
 * was deleted 2026-07-29 once the write flag was confirmed live) — NOT a new self-serve
 * adjustment-request flow/page. Fields are pre-filled from the computed comp gap and remain
 * editable; nothing is auto-submitted, same "suggest, human confirms" pattern as the
 * Suggested Successors panel.
 */
export function RequestAdjustmentModal({
  userId,
  employeeName,
  previousSalary,
  suggestedNewSalary,
  onClose,
}: RequestAdjustmentModalProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [newSalary, setNewSalary] = useState(String(Math.round(suggestedNewSalary)));
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());

  const submit = useCompensationCreateAdjustment({
    onSuccess: () => {
      // All compensation reads (incl. the FX-dependent getDashboardKpis) are C#-only now. Refresh
      // the C# platform-api succession (comp-gap) AND compensation reads — this prefix invalidation
      // is the ONLY thing that refreshes any of them.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'succession'] });
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
      toast(t.succession.requestAdjustmentSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const parsedNewSalary = Number(newSalary);
  const canSubmit = Number.isFinite(parsedNewSalary) && parsedNewSalary > 0 && !!effectiveDate && !submit.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    submit.mutate({
      userId,
      type: 'market',
      previousSalary,
      newSalary: parsedNewSalary,
      reason: reason.trim() || undefined,
      effectiveDate: new Date(effectiveDate).toISOString(),
    });
  };

  const dirty = !submit.isPending && (reason.trim().length > 0 || newSalary !== String(Math.round(suggestedNewSalary)));

  return (
    <Modal
      title={t.succession.requestAdjustmentTitle}
      onClose={onClose}
      size="sm"
      dirty={dirty}
      footer={
        <div className={BUTTON_GROUP_CLASSES}>
          <DialogCancelButton onCancel={onClose} disabled={submit.isPending} />
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            loading={submit.isPending}
            loadingLabel={t.succession.sending}
          >
            {t.succession.requestAdjustmentAction}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-body text-secondary">
          {t.succession.requestAdjustmentDesc} <span className="font-semibold text-primary">{employeeName}</span>
        </p>

        <Field label={t.succession.previousSalaryLabel}>
          <TextInput type="number" value={previousSalary} disabled readOnly />
        </Field>

        <Field label={t.succession.newSalaryLabel} required>
          <TextInput
            type="number"
            inputMode="decimal"
            min={1}
            value={newSalary}
            onChange={(e) => setNewSalary(e.target.value)}
            disabled={submit.isPending}
          />
        </Field>

        <Field label={t.common.date} required>
          <TextInput
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={submit.isPending}
          />
        </Field>

        <Field label={t.succession.reasonLabel} help={`${reason.length}/${MAX_REASON}`}>
          <TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
            maxLength={MAX_REASON}
            rows={3}
            placeholder={t.succession.reasonPlaceholder}
            disabled={submit.isPending}
            className="resize-none"
          />
        </Field>
      </div>
    </Modal>
  );
}
