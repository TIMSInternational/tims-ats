'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';

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
  const [approverId, setApproverId] = useState('');
  const [rejectionComment, setRejectionComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const users = trpc.user.list.useQuery({ limit: 100, isActive: true }, { enabled: status === 'draft' });
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
      setError(cause instanceof Error ? cause.message : t.common.error);
    }
  };

  if (status !== 'draft' && status !== 'pending_approval') return null;

  return (
    <div className="rounded-xl border border-[#EDEDED] bg-white p-4">
      <h3 className="mb-3 text-[14px] font-semibold text-[#1F114C]">{t.offers.approvalChain}</h3>
      {status === 'draft' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-60 flex-1 text-[12px] font-medium text-[#585858]">
            {t.offers.approver}
            <select value={approverId} onChange={(event) => setApproverId(event.target.value)} disabled={users.isLoading || users.isError} className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]">
              <option value="">{t.common.select}</option>
              {(users.data?.users ?? []).map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}
            </select>
          </label>
          <button type="button" disabled={!approverId || isPending} onClick={() => run(() => submit.mutateAsync({ id: offerId, approverIds: [approverId] }))} className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">
            {t.offers.requestApproval}
          </button>
        </div>
      )}
      {status === 'pending_approval' && isMyTurn && (
        <div className="space-y-3">
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.offers.rejectionReason}
            <textarea value={rejectionComment} maxLength={20000} onChange={(event) => setRejectionComment(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={isPending} onClick={() => run(() => approve.mutateAsync({ id: offerId }))} className="rounded-lg bg-green-600 px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t.offers.approve}</button>
            <button type="button" disabled={isPending || !rejectionComment.trim()} onClick={() => run(() => reject.mutateAsync({ id: offerId, comment: rejectionComment.trim() }))} className="rounded-lg border border-red-300 px-4 py-2 text-[12px] font-medium text-red-700 disabled:opacity-50">{t.offers.reject}</button>
          </div>
        </div>
      )}
      {users.isError && <p role="alert" className="mt-2 text-[12px] text-red-600">{users.error.message}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
