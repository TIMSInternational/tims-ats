'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n, formatMessage } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { BUTTON_GROUP_CLASSES, Button, Field, Modal, TextArea } from '../../../components';
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

  const isApprove = mode === 'approve';
  // The title states the outcome and names the person; one line says what happens next.
  const title = formatMessage(isApprove ? t.compensation.approveTitle : t.compensation.rejectTitle, {
    name: employeeName,
  });
  const consequence = isApprove ? t.compensation.approveConsequence : t.compensation.rejectConsequence;
  const actionLabel = isApprove ? t.compensation.approveConfirm : t.compensation.rejectConfirm;

  return (
    <Modal
      title={title}
      description={consequence}
      onClose={onClose}
      size="sm"
      footer={
        <div className={BUTTON_GROUP_CLASSES}>
          <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
            {t.common.cancel}
          </Button>
          <Button
            variant={isApprove ? 'primary' : 'destructive'}
            onClick={onSubmit}
            loading={submit.isPending}
            loadingLabel={t.common.saving}
            disabled={submit.isPending}
          >
            {actionLabel}
          </Button>
        </div>
      }
    >
      <Field
        label={t.compensation.commentLabel}
        help={formatMessage(t.compensation.commentCount, { n: comment.length, max: MAX_COMMENT })}
      >
        <TextArea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
          maxLength={MAX_COMMENT}
          rows={3}
          placeholder={t.compensation.commentPlaceholder}
          disabled={submit.isPending}
          className="resize-none"
        />
      </Field>
    </Modal>
  );
}
