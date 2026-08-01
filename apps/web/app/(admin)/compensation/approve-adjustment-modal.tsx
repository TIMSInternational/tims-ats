'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { Modal } from '../../../components';
import { useCompensationApproveAdjustment } from '../../../lib/platform-api/compensation';

interface ApproveAdjustmentModalProps {
  adjustmentId: string;
  employeeName: string;
  mode: 'approve' | 'reject';
  onClose: () => void;
}

const MAX_COMMENT = 500;

export function ApproveAdjustmentModal({ adjustmentId, employeeName, mode, onClose }: ApproveAdjustmentModalProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [comment, setComment] = useState('');

  const submit = useCompensationApproveAdjustment({
    onSuccess: () => {
      // All compensation reads (incl. the FX-dependent dashboard-kpis/band-distribution/
      // total-comp-breakdown) are C#-only now — this prefix invalidation is the ONLY thing that
      // refreshes any of them.
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'compensation'] });
      toast(mode === 'approve' ? t.compensation.approveSuccess : t.compensation.rejectSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const onSubmit = () => {
    if (submit.isPending) return;
    submit.mutate({ id: adjustmentId, approved: mode === 'approve', comment: comment.trim() || undefined });
  };

  const title = mode === 'approve' ? t.compensation.approveTitle : t.compensation.rejectTitle;
  const confirmBody = mode === 'approve' ? t.compensation.approveConfirmBody : t.compensation.rejectConfirmBody;
  const actionLabel = mode === 'approve' ? t.compensation.approveAction : t.compensation.rejectAction;

  return (
    <Modal title={title} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-[13px] text-[#585858]">
          {confirmBody} <span className="font-semibold text-[#333]">{employeeName}</span>?
        </p>

        <div>
          <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.compensation.commentLabel}</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
            maxLength={MAX_COMMENT}
            rows={3}
            placeholder={t.compensation.commentPlaceholder}
            disabled={submit.isPending}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] resize-none focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8B8B8B] text-right mt-1">
            {comment.length}/{MAX_COMMENT}
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
            disabled={submit.isPending}
            className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submit.isPending ? t.common.saving : actionLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
