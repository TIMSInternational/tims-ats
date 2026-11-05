'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Modal } from '../../../../../components';

export interface WithdrawErrorLabels {
  withdrawErrorNotActive: string;
  withdrawErrorOpenOffer: string;
  withdrawErrorGeneric: string;
}

/**
 * The candidate-facing message for a failed withdrawal, from the tRPC error code the service sets
 * (candidate-portal.service.ts withdrawMyApplication): CONFLICT = no longer in process,
 * PRECONDITION_FAILED = an open offer for that vacancy; anything else is a generic retry message.
 */
export function withdrawErrorMessage(code: string | undefined, labels: WithdrawErrorLabels, orgName: string): string {
  if (code === 'CONFLICT') return labels.withdrawErrorNotActive;
  if (code === 'PRECONDITION_FAILED') return labels.withdrawErrorOpenOffer.replace('{org}', orgName);
  return labels.withdrawErrorGeneric;
}

// "Retirar mi postulación" (audit C-33) for ONE active application: a confirmation dialog, then the
// application moves to the existing 'withdrawn' status and the list refreshes ("Retirada").
export function DashboardWithdrawApplication({
  orgSlug,
  orgName,
  applicationId,
  vacancyTitle,
}: {
  orgSlug: string;
  orgName: string;
  applicationId: string;
  vacancyTitle: string;
}) {
  const { t } = useI18n();
  const pd = t.portalDashboard;
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const refresh = () =>
    Promise.all([
      utils.candidatePortal.myApplications.invalidate({ orgSlug }),
      utils.candidatePortal.applicationStatus.invalidate({ orgSlug, applicationId }),
    ]);

  const withdraw = trpc.candidatePortal.withdrawMyApplication.useMutation({
    onSuccess: async () => {
      setOpen(false);
      toast(pd.withdrawDone.replace('{vacancy}', vacancyTitle), { type: 'success' });
      await refresh();
    },
    onError: (err) => {
      const message = withdrawErrorMessage(err.data?.code, pd, orgName);
      setError(message);
      toast(message, { type: 'error' });
      // The status changed elsewhere (e.g. a decision was recorded meanwhile): show the current one.
      if (err.data?.code === 'CONFLICT') void refresh();
    },
  });

  const close = () => {
    if (withdraw.isPending) return;
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
        className="shrink-0 text-[12px] font-medium text-[#B42318] hover:underline"
      >
        {pd.withdrawAction}
      </button>

      {open && (
        <Modal title={pd.withdrawConfirmTitle} onClose={close}>
          <p className="text-[13px] text-[#585858]">
            {pd.withdrawConfirmBody.replace('{vacancy}', vacancyTitle).replace('{org}', orgName)}
          </p>
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700"
            >
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={withdraw.isPending}
              onClick={close}
              className="h-10 rounded-xl border border-[#EDEDED] px-4 text-[13px] text-[#585858] hover:bg-[#F6F6F6] disabled:opacity-50"
            >
              {pd.withdrawCancel}
            </button>
            <button
              type="button"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate({ orgSlug, applicationId })}
              className="h-10 rounded-xl bg-[#DD0C15] px-5 text-[13px] font-semibold text-white hover:bg-[#b80a12] disabled:opacity-50"
            >
              {withdraw.isPending ? pd.withdrawSubmitting : pd.withdrawConfirm}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
