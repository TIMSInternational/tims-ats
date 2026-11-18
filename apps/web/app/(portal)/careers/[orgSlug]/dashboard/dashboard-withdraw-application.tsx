'use client';

import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { EvalAlertDialog } from './eval-alert-dialog';
import { EvalButton } from './eval-button';
import { EvalCallout } from './eval-callout';

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
// In the TIMS evaluation design: the trigger is the PCA secondary shape with danger text (a destructive action on the
// page), the confirmation is the PCA AlertDialog in the danger tone (the frame's leave-dialog recipe) whose confirm is
// the filled danger button; Cancel first in the DOM, the confirm last.
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
      // Said inside the dialog, beside the action that failed (the dialog stays open), and as a toast
      // (frontend.md: onError toast on every mutation).
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
      <EvalButton
        variant="secondary-danger"
        size="compact"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        {pd.withdrawAction}
      </EvalButton>

      {open && (
        <EvalAlertDialog
          tone="danger"
          icon={<Undo2 aria-hidden="true" />}
          title={pd.withdrawConfirmTitle}
          body={pd.withdrawConfirmBody.replace('{vacancy}', vacancyTitle).replace('{org}', orgName)}
          onClose={close}
          actions={
            <>
              <EvalButton variant="secondary" disabled={withdraw.isPending} onClick={close}>
                {pd.withdrawCancel}
              </EvalButton>
              <EvalButton
                variant="danger"
                loading={withdraw.isPending}
                loadingLabel={pd.withdrawSubmitting}
                onClick={() => withdraw.mutate({ orgSlug, applicationId })}
              >
                {pd.withdrawConfirm}
              </EvalButton>
            </>
          }
        >
          {error && (
            <EvalCallout tone="err" role="alert">
              {error}
            </EvalCallout>
          )}
        </EvalAlertDialog>
      )}
    </>
  );
}
