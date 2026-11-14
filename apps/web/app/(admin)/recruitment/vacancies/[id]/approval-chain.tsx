'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { usePermissions } from '../../../../../lib/permissions';
import { formatDate } from '../../../../../lib/format-utils';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { Button } from '../../../../../components';
import { canSubmitForApproval, findPendingApprovalForUser } from '../../../../../lib/vacancy-approval-helpers';
import { WithdrawApprovalModal } from './withdraw-approval-modal';
import { ApprovalStepIcon } from './approval-step-icon';

interface Approval {
  id: string;
  step: number;
  status: string;
  comment: string | null;
  decidedAt: Date | string | null;
  approver: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
  };
}

interface ApprovalChainProps {
  vacancyId: string;
  vacancyStatus: string;
  approvals: Approval[];
}

// Solid status tokens: white glyphs on them pass 3:1 for icons (accessibility.md › Vision).
const STATUS_ICONS: Record<string, { bg: string; text: string; icon: 'check' | 'x' | 'clock' }> = {
  approved: { bg: 'bg-success', text: 'text-success', icon: 'check' },
  rejected: { bg: 'bg-danger', text: 'text-danger', icon: 'x' },
  pending: { bg: 'bg-warning', text: 'text-warning', icon: 'clock' },
  cancelled: { bg: 'bg-muted', text: 'text-secondary', icon: 'x' },
};

/**
 * The approval steps of a vacancy and the submitter's way to take a pending request back. Submitting lives in the
 * page header ("Enviar para aprobación"); an approver decides in the callout at the top of the page.
 */
export function ApprovalChain({ vacancyId, vacancyStatus, approvals }: ApprovalChainProps) {
  const { t } = useI18n();
  const { can, userId } = usePermissions();
  const utils = trpc.useUtils();
  const [withdrawStepId, setWithdrawStepId] = useState<string | null>(null);

  const invalidate = () => {
    utils.vacancy.getById.invalidate({ id: vacancyId });
    utils.vacancy.list.invalidate();
  };

  // Stuck-approval unblock: whoever may submit a vacancy may take a pending request back (same gate).
  const withdrawApproval = trpc.vacancy.withdrawApproval.useMutation({
    onSuccess: () => {
      invalidate();
      setWithdrawStepId(null);
      toast(t.vacancies.withdrawApprovalSuccess, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: an approver decided first - refetch so the stale button goes.
      if (err.data?.code === 'CONFLICT') {
        invalidate();
        setWithdrawStepId(null);
      }
    },
  });

  const pendingStepForViewer = findPendingApprovalForUser(approvals, userId);
  const canSubmit = canSubmitForApproval(vacancyStatus) && can('vacancy', 'update');
  // Withdrawals name the step the viewer saw, so a stale tab can never act on a newer, resubmitted request.
  const livePendingStepId = approvals.find((a) => a.status === 'pending')?.id;
  // Also offered to a submitter who is one of the approvers (Codex P2).
  const showWithdrawButton = vacancyStatus === 'pending_approval' && can('vacancy', 'update') && !!livePendingStepId;
  const openWithdrawStepId = withdrawStepId !== null && withdrawStepId === livePendingStepId ? withdrawStepId : null;
  // A rejected request returns to draft: the most recent decision tells the submitter what to do next (edit,
  // then resubmit). A viewer who cannot submit (e.g. a leader who requested it) is told who moves it on.
  const lastDecision = [...approvals]
    .filter((a) => a.decidedAt !== null)
    .sort((a, b) => new Date(b.decidedAt ?? 0).getTime() - new Date(a.decidedAt ?? 0).getTime())[0];
  const showRejectedHint = vacancyStatus === 'draft' && canSubmit && lastDecision?.status === 'rejected';
  const showAwaitingHrHint = vacancyStatus === 'draft' && !canSubmit;

  return (
    <section
      aria-labelledby="vacancy-approval-chain-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="vacancy-approval-chain-title" className="text-heading font-semibold text-brand">
          {t.vacancies.approvalChain}
        </h2>
        {showWithdrawButton && (
          <Button variant="tertiary" size="sm" onClick={() => setWithdrawStepId(livePendingStepId ?? null)}>
            {t.vacancies.withdrawApproval}
          </Button>
        )}
      </div>

      {showAwaitingHrHint && <p className="mb-2 text-callout text-secondary">{t.vacancies.draftAwaitingHr}</p>}
      {showRejectedHint && (
        <p className="mb-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-callout text-warning">
          {t.vacancies.rejectedEditHint}
        </p>
      )}

      <ol>
        {approvals.map((a, i) => {
          const config = STATUS_ICONS[a.status] ?? STATUS_ICONS.pending;
          const isViewersPendingStep = pendingStepForViewer?.id === a.id;
          return (
            <li key={a.id}>
              {i > 0 && <div aria-hidden="true" className="ml-3 h-4 w-0.5 bg-border" />}
              <div className="flex items-start gap-3 py-2">
                <div
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full ${config.bg}`}
                >
                  <ApprovalStepIcon icon={config.icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-body text-primary">
                    {a.approver.firstName} {a.approver.lastName}
                  </p>
                  <p className={`text-callout ${config.text}`}>
                    {a.status === 'approved' &&
                      `${t.vacancies.approved} — ${a.decidedAt ? formatDate(a.decidedAt) : ''}`}
                    {a.status === 'rejected' &&
                      `${t.vacancies.rejected} — ${a.decidedAt ? formatDate(a.decidedAt) : ''}`}
                    {a.status === 'pending' &&
                      (isViewersPendingStep ? t.vacancies.awaitingYourDecision : t.vacancies.pending)}
                    {a.status === 'cancelled' && t.vacancies.cancelled}
                  </p>
                  {a.comment && (
                    <blockquote className="mt-1 border-l-2 border-border pl-2 text-callout text-secondary">
                      <span className="font-medium">
                        {a.status === 'rejected' ? t.vacancies.rejectionReasonPrefix : t.vacancies.commentPrefix}
                      </span>{' '}
                      {a.comment}
                    </blockquote>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {openWithdrawStepId !== null && (
        <WithdrawApprovalModal
          onConfirm={() => withdrawApproval.mutate({ id: vacancyId, approvalId: openWithdrawStepId })}
          onClose={() => setWithdrawStepId(null)}
          isPending={withdrawApproval.isPending}
        />
      )}
    </section>
  );
}
