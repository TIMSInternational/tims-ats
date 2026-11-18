'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { usePermissions } from '../../../../../lib/permissions';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { Button } from '../../../../../components';
import { findPendingApprovalForUser } from '../../../../../lib/vacancy-approval-helpers';
import { RejectModal } from './reject-modal';

interface DecisionApproval {
  id: string;
  status: string;
  approver: { id: string };
}

interface ApprovalDecisionCalloutProps {
  vacancyId: string;
  approvals: DecisionApproval[];
}

/**
 * For an approver, deciding is the page's one task, so it opens the content (layout.md › Visual hierarchy:
 * the most important items near the top) instead of two small links at the end of the right column. Renders
 * nothing unless the viewer has a pending step. "Aprobar" is the only primary; "Rechazar…" asks for a reason.
 */
export function ApprovalDecisionCallout({ vacancyId, approvals }: ApprovalDecisionCalloutProps) {
  const { t } = useI18n();
  const { userId } = usePermissions();
  const utils = trpc.useUtils();
  // The reject dialog remembers the step it was opened for (Codex P1): the decision is sent for THAT step,
  // and the dialog closes by itself when a refetch shows a different step (withdrawn and resubmitted).
  const [rejectStepId, setRejectStepId] = useState<string | null>(null);

  const invalidate = () => {
    utils.vacancy.getById.invalidate({ id: vacancyId });
    utils.vacancy.list.invalidate();
  };

  const approve = trpc.vacancy.approve.useMutation({
    onSuccess: () => {
      invalidate();
      toast(t.vacancies.approveSuccess, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: the vacancy moved on (another approver decided first) - refetch so stale buttons go.
      if (err.data?.code === 'CONFLICT') invalidate();
    },
  });

  const reject = trpc.vacancy.reject.useMutation({
    onSuccess: () => {
      invalidate();
      setRejectStepId(null);
      toast(t.vacancies.rejectSuccess, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: the vacancy moved on - close the dialog (its reason was for that request) and refetch.
      if (err.data?.code === 'CONFLICT') {
        invalidate();
        setRejectStepId(null);
      }
    },
  });

  const step = findPendingApprovalForUser(approvals, userId);
  const openRejectStepId = rejectStepId !== null && rejectStepId === step?.id ? rejectStepId : null;
  if (!step) return null;

  return (
    <section
      aria-labelledby="vacancy-awaiting-approval-title"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-bg p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div role="status" className="min-w-0">
        <h2 id="vacancy-awaiting-approval-title" className="text-subheading font-semibold text-primary">
          {t.vacancies.awaitingYourApproval}
        </h2>
        <p className="mt-0.5 text-callout text-secondary">{t.vacancies.awaitingYourApprovalDesc}</p>
      </div>
      <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
        <Button
          variant="destructive-secondary"
          onClick={() => setRejectStepId(step.id)}
          fullWidth
          className="sm:w-auto"
        >
          {t.vacancies.rejectStepEllipsis}
        </Button>
        <Button
          onClick={() => approve.mutate({ id: vacancyId, approvalId: step.id })}
          loading={approve.isPending}
          fullWidth
          className="sm:w-auto"
        >
          {t.vacancies.approveStep}
        </Button>
      </div>

      {openRejectStepId !== null && (
        <RejectModal
          onConfirm={(comment) => reject.mutate({ id: vacancyId, approvalId: openRejectStepId, comment })}
          onClose={() => setRejectStepId(null)}
          isPending={reject.isPending}
        />
      )}
    </section>
  );
}
