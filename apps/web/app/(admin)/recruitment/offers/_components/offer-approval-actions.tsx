'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { useCan } from '../../../../../lib/permissions';
import { describeOfferActionError, isStateConflict } from '../../../../../lib/offer-action-error';
import { UserPicker, type PickedUser } from '../../../../../components/user-picker';
import { Button } from '../../../../../components/button';
import { BUTTON_GROUP_CLASSES, TEXT_LINK_CLASSES } from '../../../../../components/button-styles';
import { FIELD_LABEL_CLASSES, textareaClasses } from '../../../../../components/field-styles';

// An open confirmation remembers the step it was opened for (Codex P1): a decision or withdrawal is
// sent for THAT step, and the confirmation closes by itself when a refetch shows a different step.
type Decision = { kind: 'approve' | 'reject'; stepId: string };

// Decision rows put Cancel and the secondary actions first and the primary last; below sm they stack full
// width with the primary on top (buttons.md › Style, foundation-spec.md §5).
const ROW = `${BUTTON_GROUP_CLASSES} [&>*]:max-sm:w-full`;

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
    <Button variant="secondary" disabled={isPending} onClick={() => setWithdrawStepId(livePendingStep.id)}>
      {t.offers.withdrawApproval}
    </Button>
  );

  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5" aria-labelledby="offer-approval-actions-title">
      <h2 id="offer-approval-actions-title" className="mb-3 text-heading font-semibold text-brand">{title}</h2>
      {status === 'draft' && (
        <div className="space-y-3">
          <p className="text-body font-medium text-primary">{t.offers.approver}</p>
          {/* Server-side search (not a fixed first page) so every eligible approver stays reachable. */}
          {approver ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className="truncate text-body text-primary">
                {approver.firstName} {approver.lastName}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setApprover(null)}
                className={`${TEXT_LINK_CLASSES} disabled:opacity-50`}
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
          <Button disabled={!approver || isPending} onClick={() => approver && requestApproval(approver)}>
            {t.offers.requestApproval}
          </Button>
        </div>
      )}
      {status === 'pending_approval' && confirmWithdrawStepId !== null && (
        <div className="space-y-3">
          <p className="text-callout text-secondary">{t.offers.withdrawApprovalPrompt}</p>
          <div className={ROW}>
            <Button variant="secondary" disabled={isPending} onClick={() => setWithdrawStepId(null)}>
              {t.common.cancel}
            </Button>
            <Button
              loading={isPending}
              onClick={() =>
                run(async () => {
                  await withdraw.mutateAsync({ id: offerId, approvalId: confirmWithdrawStepId });
                  return t.offers.withdrawApprovalSuccess;
                })
              }
            >
              {t.offers.withdrawApprovalConfirm}
            </Button>
          </div>
        </div>
      )}
      {status === 'pending_approval' && !confirmingWithdraw && isMyTurn && activeDecision === null && (
        <div className={ROW}>
          {withdrawButton}
          <Button variant="destructive-secondary" disabled={isPending} onClick={() => startDecision('reject')}>
            {t.offers.reject}
          </Button>
          <Button disabled={isPending} onClick={() => startDecision('approve')}>
            {t.offers.approve}
          </Button>
        </div>
      )}
      {status === 'pending_approval' && !confirmingWithdraw && activeDecision !== null && (
        <div className="space-y-3">
          <div>
            <label htmlFor="offer-decision-comment" className={FIELD_LABEL_CLASSES}>
              {activeDecision.kind === 'reject' ? (
                <>
                  {t.offers.rejectionReason}
                  <span aria-hidden="true"> *</span>
                </>
              ) : (
                t.offers.approvalCommentOptional
              )}
            </label>
            <textarea
              id="offer-decision-comment"
              value={comment}
              maxLength={20000}
              autoFocus
              required={activeDecision.kind === 'reject'}
              onChange={(event) => setComment(event.target.value)}
              className={textareaClasses()}
            />
          </div>
          <div className={ROW}>
            <Button variant="secondary" disabled={isPending} onClick={closeForms}>
              {t.common.cancel}
            </Button>
            {activeDecision.kind === 'approve' ? (
              <Button
                loading={isPending}
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
              >
                {t.offers.approveConfirm}
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={!comment.trim()}
                loading={isPending}
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
              >
                {t.offers.rejectConfirm}
              </Button>
            )}
          </div>
        </div>
      )}
      {status === 'pending_approval' && !confirmingWithdraw && !isMyTurn && canRequest && (
        <div className="space-y-3">
          <p className="text-callout text-secondary">{t.offers.awaitingApproverDecision}</p>
          {withdrawButton}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-callout text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
