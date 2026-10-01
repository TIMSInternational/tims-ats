'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { describeOfferActionError, isStateConflict } from '../../../../../lib/offer-action-error';
import { UserPicker, type PickedUser } from '../../../../../components/user-picker';

export function OfferApprovalActions({
  offerId,
  status,
  approvals,
  onUpdated,
}: {
  offerId: string;
  status: string;
  approvals: Array<{ approver: { id: string }; status: string }>;
  onUpdated: () => void;
}) {
  const { t } = useI18n();
  const [approver, setApprover] = useState<PickedUser | null>(null);
  const [rejectionComment, setRejectionComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const me = trpc.user.me.useQuery(undefined, { enabled: status === 'pending_approval' });
  const submit = trpc.offer.submitForApproval.useMutation();
  const approve = trpc.offer.approve.useMutation();
  const reject = trpc.offer.reject.useMutation();
  const isPending = submit.isPending || approve.isPending || reject.isPending;
  const isMyTurn = approvals.some((item) => item.approver.id === me.data?.id && item.status === 'pending');

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onUpdated();
    } catch (cause) {
      const message = describeOfferActionError(cause, { forbidden: t.offers.errorForbiddenAction, generic: t.offers.errorOfferAction });
      setError(message);
      toast(message, { type: 'error' });
      // Another decision won the race: refetch so the stale approve/reject buttons disappear.
      if (isStateConflict(cause)) onUpdated();
    }
  };

  if (status !== 'draft' && status !== 'pending_approval') return null;

  return (
    <div className="rounded-xl border border-[#EDEDED] bg-white p-4">
      <h3 className="mb-3 text-[14px] font-semibold text-[#1F114C]">{t.offers.approvalChain}</h3>
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
            onClick={() => approver && run(() => submit.mutateAsync({ id: offerId, approverIds: [approver.id] }))}
            className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t.offers.requestApproval}
          </button>
        </div>
      )}
      {status === 'pending_approval' && isMyTurn && (
        <div className="space-y-3">
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.offers.rejectionReason}
            <textarea
              value={rejectionComment}
              maxLength={20000}
              onChange={(event) => setRejectionComment(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => approve.mutateAsync({ id: offerId }))}
              className="rounded-lg bg-green-600 px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {t.offers.approve}
            </button>
            <button
              type="button"
              disabled={isPending || !rejectionComment.trim()}
              onClick={() => run(() => reject.mutateAsync({ id: offerId, comment: rejectionComment.trim() }))}
              className="rounded-lg border border-red-300 px-4 py-2 text-[12px] font-medium text-red-700 disabled:opacity-50"
            >
              {t.offers.reject}
            </button>
          </div>
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
