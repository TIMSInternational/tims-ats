'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { usePermissions } from '../../../../../lib/permissions';
import { formatDate } from '../../../../../lib/format-utils';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { canSubmitForApproval, findPendingApprovalForUser } from '../../../../../lib/vacancy-approval-helpers';
import { SubmitApprovalModal } from './submit-approval-modal';
import { RejectModal } from './reject-modal';
import { WithdrawApprovalModal } from './withdraw-approval-modal';

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

const STATUS_ICONS: Record<string, { bg: string; icon: 'check' | 'x' | 'clock' }> = {
  approved: { bg: 'bg-green-500', icon: 'check' },
  rejected: { bg: 'bg-[#DD0C15]', icon: 'x' },
  pending: { bg: 'bg-amber-400', icon: 'clock' },
  cancelled: { bg: 'bg-gray-300', icon: 'x' },
};

export function ApprovalChain({ vacancyId, vacancyStatus, approvals }: ApprovalChainProps) {
  const { t } = useI18n();
  const { can, userId } = usePermissions();
  const utils = trpc.useUtils();
  const [showSubmit, setShowSubmit] = useState(false);
  // Each open dialog remembers the step it was opened for (Codex P1): the decision is sent for THAT step,
  // and the dialog closes by itself when a refetch shows a different step (withdrawn and resubmitted).
  const [rejectStepId, setRejectStepId] = useState<string | null>(null);
  const [withdrawStepId, setWithdrawStepId] = useState<string | null>(null);

  const invalidate = () => {
    utils.vacancy.getById.invalidate({ id: vacancyId });
    utils.vacancy.list.invalidate();
  };

  const submitForApproval = trpc.vacancy.submitForApproval.useMutation({
    onSuccess: () => { invalidate(); setShowSubmit(false); toast(t.vacancies.submitForApprovalSuccess, { type: 'success' }); },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: the vacancy moved on (another approver decided first) - refetch so stale buttons go.
      if (err.data?.code === 'CONFLICT') invalidate();
    },
  });

  const approve = trpc.vacancy.approve.useMutation({
    onSuccess: () => { invalidate(); toast(t.vacancies.approveSuccess, { type: 'success' }); },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: the vacancy moved on (another approver decided first) - refetch so stale buttons go.
      if (err.data?.code === 'CONFLICT') invalidate();
    },
  });

  const reject = trpc.vacancy.reject.useMutation({
    onSuccess: () => { invalidate(); setRejectStepId(null); toast(t.vacancies.rejectSuccess, { type: 'success' }); },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: the vacancy moved on - close the dialog (its reason was for that request) and refetch.
      if (err.data?.code === 'CONFLICT') { invalidate(); setRejectStepId(null); }
    },
  });

  // Stuck-approval unblock: whoever may submit a vacancy may take a pending request back (same gate).
  const withdrawApproval = trpc.vacancy.withdrawApproval.useMutation({
    onSuccess: () => { invalidate(); setWithdrawStepId(null); toast(t.vacancies.withdrawApprovalSuccess, { type: 'success' }); },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: an approver decided first - refetch so the stale button goes.
      if (err.data?.code === 'CONFLICT') { invalidate(); setWithdrawStepId(null); }
    },
  });

  const pendingStepForViewer = findPendingApprovalForUser(approvals, userId);
  const showSubmitButton = canSubmitForApproval(vacancyStatus) && can('vacancy', 'update');
  // Decisions and withdrawals name the step the viewer saw, so a stale tab can never act on a newer,
  // resubmitted request (the server answers CONFLICT and the chain refetches).
  const livePendingStepId = approvals.find((a) => a.status === 'pending')?.id;
  // Also offered to a submitter who is one of the approvers (Codex P2): they can take the request back
  // without first deciding their own step.
  const showWithdrawButton = vacancyStatus === 'pending_approval' && can('vacancy', 'update') && !!livePendingStepId;
  const openRejectStepId = rejectStepId !== null && rejectStepId === pendingStepForViewer?.id ? rejectStepId : null;
  const openWithdrawStepId = withdrawStepId !== null && withdrawStepId === livePendingStepId ? withdrawStepId : null;
  // A rejected request returns to draft: the most recent decision tells the submitter what to do next (edit,
  // then resubmit). A viewer who cannot submit (e.g. a leader who requested it) is told who moves it on.
  const lastDecision = [...approvals]
    .filter((a) => a.decidedAt !== null)
    .sort((a, b) => new Date(b.decidedAt ?? 0).getTime() - new Date(a.decidedAt ?? 0).getTime())[0];
  const showRejectedHint = vacancyStatus === 'draft' && showSubmitButton && lastDecision?.status === 'rejected';
  const showAwaitingHrHint = vacancyStatus === 'draft' && !showSubmitButton;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.vacancies.approvalChain}</h3>
        {showSubmitButton && (
          <button
            onClick={() => {
              submitForApproval.reset();
              setShowSubmit(true);
            }}
            className="text-[12px] text-[#DD0C15] font-medium"
          >
            {t.vacancies.submitForApproval}
          </button>
        )}
        {showWithdrawButton && (
          <button
            type="button"
            onClick={() => setWithdrawStepId(livePendingStepId ?? null)}
            className="text-[12px] text-[#585858] font-medium hover:text-[#1F114C]"
          >
            {t.vacancies.withdrawApproval}
          </button>
        )}
      </div>

      {showAwaitingHrHint && <p className="text-[12px] text-[#8B8B8B] mb-2">{t.vacancies.draftAwaitingHr}</p>}
      {showRejectedHint && (
        <p className="text-[12px] text-[#92400e] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
          {t.vacancies.rejectedEditHint}
        </p>
      )}

      <div className="space-y-0">
        {approvals.map((a, i) => {
          const config = STATUS_ICONS[a.status] ?? STATUS_ICONS.pending;
          const isViewersPendingStep = pendingStepForViewer?.id === a.id;
          return (
            <div key={a.id}>
              {i > 0 && <div className="ml-3 w-0.5 h-4 bg-[#EDEDED]" />}
              <div className="flex items-center gap-3 py-2">
                <div className={`w-6 h-6 rounded-full ${config.bg} flex items-center justify-center shrink-0`}>
                  {config.icon === 'check' && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m4.5 12.75 6 6 9-13.5" /></svg>
                  )}
                  {config.icon === 'x' && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                  {config.icon === 'clock' && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-[12px] text-[#333]">
                    {a.approver.firstName} {a.approver.lastName}
                  </p>
                  <p className={`text-[10px] ${
                    a.status === 'approved' ? 'text-green-600' :
                    a.status === 'rejected' ? 'text-[#DD0C15]' :
                    a.status === 'pending' ? 'text-amber-600' :
                    'text-[#8B8B8B]'
                  }`}>
                    {a.status === 'approved' && `${t.vacancies.approved} — ${a.decidedAt ? formatDate(a.decidedAt) : ''}`}
                    {a.status === 'rejected' && `${t.vacancies.rejected} — ${a.decidedAt ? formatDate(a.decidedAt) : ''}`}
                    {a.status === 'pending' && t.vacancies.pending}
                    {a.status === 'cancelled' && t.vacancies.cancelled}
                  </p>
                  {a.comment && <p className="text-[10px] text-[#8B8B8B] mt-0.5 italic">{a.comment}</p>}
                </div>
                {isViewersPendingStep && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => approve.mutate({ id: vacancyId, approvalId: a.id })}
                      disabled={approve.isPending}
                      className="text-[11px] font-medium text-green-600 hover:text-green-700 disabled:opacity-50"
                    >
                      {t.vacancies.approveStep}
                    </button>
                    <button
                      onClick={() => setRejectStepId(a.id)}
                      className="text-[11px] font-medium text-[#DD0C15] hover:text-[#c00b13]"
                    >
                      {t.vacancies.rejectStep}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showSubmit && (
        <SubmitApprovalModal
          vacancyId={vacancyId}
          errorMessage={submitForApproval.error?.message ?? null}
          onConfirm={(approverIds) => submitForApproval.mutate({ id: vacancyId, approverIds })}
          onClose={() => setShowSubmit(false)}
          isPending={submitForApproval.isPending}
        />
      )}
      {openWithdrawStepId !== null && (
        <WithdrawApprovalModal
          onConfirm={() => withdrawApproval.mutate({ id: vacancyId, approvalId: openWithdrawStepId })}
          onClose={() => setWithdrawStepId(null)}
          isPending={withdrawApproval.isPending}
        />
      )}
      {openRejectStepId !== null && (
        <RejectModal
          onConfirm={(comment) => reject.mutate({ id: vacancyId, approvalId: openRejectStepId, comment })}
          onClose={() => setRejectStepId(null)}
          isPending={reject.isPending}
        />
      )}
    </div>
  );
}
