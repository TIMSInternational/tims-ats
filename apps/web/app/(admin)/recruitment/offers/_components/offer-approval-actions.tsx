'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { useCan } from '../../../../../lib/permissions';
import { describeOfferActionError, isStateConflict } from '../../../../../lib/offer-action-error';
import { UserPicker, type PickedUser } from '../../../../../components/user-picker';

// An open confirmation remembers the step it was opened for (Codex P1): a decision or withdrawal is
// sent for THAT step, and the confirmation closes by itself when a refetch shows a different step.
type Decision = { kind: 'approve' | 'reject'; stepId: string };

const SECONDARY_BUTTON =
  'rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px] font-medium text-[#585858] disabled:opacity-50';

export function OfferApprovalActions({
  offerId,
  status,
  approvals,
  onUpdated,
}: {
  offerId: string;
  status: string;
  approvals: Array<{ id: string; approver: { id: string }; status: string }>;
  onUpdated: () => void;
}) {
  const { t } = useI18n();
  const can = useCan();
  const [approver, setApprover] = useState<PickedUser | null>(null);
  // B-13: approve and reject are each a deliberate second step; the reason box appears only for reject.
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState('');
  const [withdrawStepId, setWithdrawStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = trpc.user.me.useQuery(undefined, { enabled: status === 'pending_approval' });
  const submit = trpc.offer.submitForApproval.useMutation();
  const approve = trpc.offer.approve.useMutation();
  const reject = trpc.offer.reject.useMutation();
  const withdraw = trpc.offer.withdrawApproval.useMutation();
  const isPending = submit.isPending || approve.isPending || reject.isPending || withdraw.isPending;
  // Decisions and withdrawals name the step the viewer saw, so a stale tab can never act on a newer,
  // resubmitted request (the server answers CONFLICT and the card refetches).
  const myStep = approvals.find((item) => item.approver.id === me.data?.id && item.status === 'pending');
  const isMyTurn = myStep !== undefined;
  const livePendingStep = approvals.find((item) => item.status === 'pending');
  // Same gate as submitForApproval / withdrawApproval on the server.
  const canRequest = can('offer', 'create') || can('offer', 'update');
  // A confirmation opened for a step that is no longer the live one (withdrawn and resubmitted) is closed.
  const activeDecision = decision !== null && decision.stepId === myStep?.id ? decision : null;
  const confirmWithdrawStepId =
    withdrawStepId !== null && withdrawStepId === livePendingStep?.id ? withdrawStepId : null;
  const confirmingWithdraw = confirmWithdrawStepId !== null;

  const closeForms = () => {
    setDecision(null);
    setComment('');
    setWithdrawStepId(null);
  };
  const startDecision = (kind: Decision['kind']) => {
    if (!myStep) return;
    setComment('');
    setDecision({ kind, stepId: myStep.id });
  };

  // `action` resolves to the success message to toast (B-13: every action confirms what happened).
  const run = async (action: () => Promise<string>) => {
    setError(null);
    try {
      const success = await action();
      toast(success, { type: 'success' });
      closeForms();
      onUpdated();
    } catch (cause) {
      const message = describeOfferActionError(cause, {
        forbidden: t.offers.errorForbiddenAction,
        generic: t.offers.errorOfferAction,
      });
      setError(message);
      toast(message, { type: 'error' });
      // The request moved on (another decision won, or it was withdrawn and resubmitted): close the open
      // confirmation, so it cannot be re-sent against the newer request, and refetch.
      if (isStateConflict(cause)) {
        closeForms();
        onUpdated();
      }
    }
  };

  if (status !== 'draft' && status !== 'pending_approval') return null;
  // Only what the viewer can actually do (Codex P2): no request form without offer:create/update, and
  // no empty card for a viewer who can neither decide nor withdraw.
  if (status === 'draft' && !canRequest) return null;
  if (status === 'pending_approval' && (me.isLoading || (!isMyTurn && (!canRequest || !livePendingStep)))) {
    return null;
  }

  // B-32: the card is titled by what the viewer can do here, not "Cadena de Aprobación" a second time.
  const title =
    status === 'draft' ? t.offers.requestApproval : isMyTurn ? t.offers.yourDecision : t.offers.approvalRequestTitle;

  const requestApproval = (picked: PickedUser) =>
    run(async () => {
      await submit.mutateAsync({ id: offerId, approverIds: [picked.id] });
      setApprover(null);
      return t.offers.approvalRequestedTo.replace('{name}', `${picked.firstName} ${picked.lastName}`.trim());
    });

  // Stuck-approval unblock: whoever may request approval can take the request back and send it to someone
  // else, also when they are one of its approvers (rejecting would end the offer for good).
  const withdrawButton = canRequest && livePendingStep && (
    <button
      type="button"
      disabled={isPending}
      onClick={() => setWithdrawStepId(livePendingStep.id)}
      className={SECONDARY_BUTTON}
    >
      {t.offers.withdrawApproval}
    </button>
  );

  return (
    <div className="rounded-xl border border-[#EDEDED] bg-white p-4">
      <h3 className="mb-3 text-[14px] font-semibold text-[#1F114C]">{title}</h3>
      {status === 'draft' && (
        <div className="space-y-3">
          <p className="text-[12px] font-medium text-[#585858]">{t.offers.approver}</p>
          {/* Server-side search (not a fixed first page) so every eligible approver stays reachable. */}
          {approver ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[#EDEDED] px-3 py-2">
              <span className="truncate text-[13px] text-[#333]">
                {approver.firstName} {approver.lastName}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setApprover(null)}
                className="text-[12px] font-medium text-[#1F114C] disabled:opacity-50"
              >
                {t.common.change}
              </button>
            </div>
          ) : (
            <UserPicker
              purpose="offer_approver"
              onSelect={(_id, user) => setApprover(user)}
              disabled={isPending}
              autoFocus={false}
              searchPlaceholder={t.common.search}
              loadingLabel={t.common.loading}
              emptyLabel={t.assignablePeople.noEligibleApprovers}
            />
          )}
          <button
            type="button"
            disabled={!approver || isPending}
            onClick={() => approver && requestApproval(approver)}
            className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t.offers.requestApproval}
          </button>
        </div>
      )}
      {status === 'pending_approval' && confirmWithdrawStepId !== null && (
        <div className="space-y-3">
          <p className="text-[12px] text-[#585858]">{t.offers.withdrawApprovalPrompt}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  await withdraw.mutateAsync({ id: offerId, approvalId: confirmWithdrawStepId });
                  return t.offers.withdrawApprovalSuccess;
                })
              }
              className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {t.offers.withdrawApprovalConfirm}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setWithdrawStepId(null)}
              className={SECONDARY_BUTTON}
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
      {status === 'pending_approval' && !confirmingWithdraw && isMyTurn && activeDecision === null && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => startDecision('approve')}
            className="rounded-lg bg-green-600 px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t.offers.approve}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => startDecision('reject')}
            className="rounded-lg border border-red-300 px-4 py-2 text-[12px] font-medium text-red-700 disabled:opacity-50"
          >
            {t.offers.reject}
          </button>
          {withdrawButton}
        </div>
      )}
      {status === 'pending_approval' && !confirmingWithdraw && activeDecision !== null && (
        <div className="space-y-3">
          <label className="block text-[12px] font-medium text-[#585858]">
            {activeDecision.kind === 'reject' ? `${t.offers.rejectionReason} *` : t.offers.approvalCommentOptional}
            <textarea
              value={comment}
              maxLength={20000}
              autoFocus
              onChange={(event) => setComment(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]"
            />
          </label>
          <div className="flex gap-2">
            {activeDecision.kind === 'approve' ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    const trimmed = comment.trim();
                    const result = await approve.mutateAsync({
                      id: offerId,
                      approvalId: activeDecision.stepId,
                      ...(trimmed ? { comment: trimmed } : {}),
                    });
                    return result.status === 'approved'
                      ? t.offers.approvalRecordedFinal
                      : t.offers.approvalRecordedPartial;
                  })
                }
                className="rounded-lg bg-green-600 px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {t.offers.approveConfirm}
              </button>
            ) : (
              <button
                type="button"
                disabled={isPending || !comment.trim()}
                onClick={() =>
                  run(async () => {
                    await reject.mutateAsync({
                      id: offerId,
                      approvalId: activeDecision.stepId,
                      comment: comment.trim(),
                    });
                    return t.offers.offerRejectedToast;
                  })
                }
                className="rounded-lg border border-red-300 px-4 py-2 text-[12px] font-medium text-red-700 disabled:opacity-50"
              >
                {t.offers.rejectConfirm}
              </button>
            )}
            <button type="button" disabled={isPending} onClick={closeForms} className={SECONDARY_BUTTON}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
      {status === 'pending_approval' && !confirmingWithdraw && !isMyTurn && canRequest && (
        <div className="space-y-3">
          <p className="text-[12px] text-[#585858]">{t.offers.awaitingApproverDecision}</p>
          {withdrawButton}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
