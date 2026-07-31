'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
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

  return (
    <Modal title={t.succession.requestAdjustmentTitle} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-[13px] text-[#585858]">
          {t.succession.requestAdjustmentDesc} <span className="font-semibold text-[#333]">{employeeName}</span>
        </p>

        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.succession.previousSalaryLabel}</label>
          <input
            type="number"
            value={previousSalary}
            disabled
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#8B8B8B] bg-[#F6F6F6] disabled:opacity-70"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.succession.newSalaryLabel}</label>
          <input
            type="number"
            min={1}
            value={newSalary}
            onChange={(e) => setNewSalary(e.target.value)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.common.date}</label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.succession.reasonLabel}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
            maxLength={MAX_REASON}
            rows={3}
            placeholder={t.succession.reasonPlaceholder}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8B8B8B] text-right mt-1">
            {reason.length}/{MAX_REASON}
          </p>
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
            {submit.isPending ? t.common.saving : t.succession.requestAdjustmentAction}
          </button>
        </div>
      </div>
    </Modal>
  );
}
