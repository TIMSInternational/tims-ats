'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Modal } from '../../../../../components';
import { Button } from '../../../../../components/button';

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
      // Said inside the dialog, beside the action that failed; the dialog stays open.
      setError(withdrawErrorMessage(err.data?.code, pd, orgName));
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
      <Button
        variant="destructive-secondary"
        size="sm"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        {pd.withdrawAction}
      </Button>

      {open && (
        <Modal
          title={pd.withdrawConfirmTitle}
          onClose={close}
          size="sm"
          footer={
            <>
              <Button variant="secondary" disabled={withdraw.isPending} onClick={close}>
                {pd.withdrawCancel}
              </Button>
              <Button
                variant="destructive"
                loading={withdraw.isPending}
                loadingLabel={pd.withdrawSubmitting}
                onClick={() => withdraw.mutate({ orgSlug, applicationId })}
              >
                {pd.withdrawConfirm}
              </Button>
            </>
          }
        >
          <p className="text-base text-secondary sm:text-body">
            {pd.withdrawConfirmBody.replace('{vacancy}', vacancyTitle).replace('{org}', orgName)}
          </p>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-bg p-3 text-callout text-danger">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
