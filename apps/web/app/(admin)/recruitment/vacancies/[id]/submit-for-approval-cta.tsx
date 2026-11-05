'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { usePermissions } from '../../../../../lib/permissions';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { canSubmitForApproval } from '../../../../../lib/vacancy-approval-helpers';
import { SubmitApprovalModal } from './submit-approval-modal';

interface SubmitForApprovalCtaProps {
  vacancyId: string;
  vacancyStatus: string;
}

/**
 * The primary "Enviar a aprobación" button in the vacancy header. A new vacancy that requires approval is
 * created as a draft, and this is the only way forward; before, it was a small text link at the bottom of
 * the right column. Same gate as the approval card's link (draft + vacancy:update; the API enforces it).
 */
export function SubmitForApprovalCta({ vacancyId, vacancyStatus }: SubmitForApprovalCtaProps) {
  const { t } = useI18n();
  const { can } = usePermissions();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  const submit = trpc.vacancy.submitForApproval.useMutation({
    onSuccess: () => {
      utils.vacancy.getById.invalidate({ id: vacancyId });
      utils.vacancy.list.invalidate();
      setOpen(false);
      toast(t.vacancies.submitForApprovalSuccess, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      // CONFLICT: the vacancy moved on in another tab - refetch so the stale button goes.
      if (err.data?.code === 'CONFLICT') utils.vacancy.getById.invalidate({ id: vacancyId });
    },
  });

  if (!canSubmitForApproval(vacancyStatus) || !can('vacancy', 'update')) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          submit.reset();
          setOpen(true);
        }}
        className="flex items-center gap-1.5 bg-[#1F114C] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#2a1a5c] transition"
      >
        {t.vacancies.submitForApproval}
      </button>
      {open && (
        <SubmitApprovalModal
          vacancyId={vacancyId}
          errorMessage={submit.error?.message ?? null}
          onConfirm={(approverIds) => submit.mutate({ id: vacancyId, approverIds })}
          onClose={() => setOpen(false)}
          isPending={submit.isPending}
        />
      )}
    </>
  );
}
