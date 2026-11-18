'use client';

import { useState } from 'react';
import { Modal } from '../../../../../../components';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import {
  adminErrorCode,
  useUnbindOrganization,
  type ProviderOpenWork,
} from '../../../../../../lib/platform-api/assessment-provider-admin';
import { AssessmentProviderOpenWork } from './assessment-provider-open-work';

// The confirmation before an unbind. It states what unbinding does, shows the open work it would strand, and offers to
// cancel the unfinished tests first (unticked by default). "Unbind" stays disabled until the platform owner
// acknowledges the consequence. The server re-checks everything under the binding lock and refuses (409) while any
// open work remains; what is left is shown here.
export function AssessmentProviderUnbindDialog({
  organizationId,
  organizationName,
  openWork,
  onClose,
}: {
  organizationId: string;
  organizationName: string;
  openWork: ProviderOpenWork;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const pa = t.providerAdmin;
  const unbind = useUnbindOrganization(organizationId);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [blocked, setBlocked] = useState<{ work: ProviderOpenWork; cancelled: number; failed: number } | null>(null);
  const errorKey = unbind.isError ? adminErrorCode(unbind.error) : null;

  const submit = () =>
    unbind.mutate(cancelOpen, {
      onSuccess: (answer) => {
        if (answer.kind === 'unbound') {
          toast(pa.unbound.replace('{n}', String(answer.cancelled)), { type: 'success' });
          onClose();
          return;
        }
        setBlocked({ work: answer.openWork, cancelled: answer.cancelled, failed: answer.cancelFailed });
      },
      onError: () => toast(pa.errors.unknown, { type: 'error' }),
    });

  return (
    <Modal title={pa.unbindConfirmTitle.replace('{org}', organizationName)} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3 text-[13px] text-[#585858]" data-testid="provider-unbind-dialog">
        <p>{pa.unbindHelp}</p>
        <AssessmentProviderOpenWork work={blocked?.work ?? openWork} />
        {blocked && (
          <p role="alert" className="text-[12px] text-[#B42318]">
            {pa.unbindBlocked
              .replace('{cancelled}', String(blocked.cancelled))
              .replace('{failed}', String(blocked.failed))}
          </p>
        )}
        {errorKey && (
          <p role="alert" className="text-[12px] text-[#B42318]">
            {(pa.errors as Record<string, string>)[errorKey] ?? pa.errors.unknown}
          </p>
        )}
        {openWork.cancellable > 0 && (
          <label className="flex items-start gap-2 text-[12px] text-[#1F114C]">
            <input type="checkbox" checked={cancelOpen} onChange={(event) => setCancelOpen(event.target.checked)} />
            <span>{pa.unbindCancelChoice.replace('{n}', String(openWork.cancellable))}</span>
          </label>
        )}
        <label className="flex items-start gap-2 text-[12px] text-[#1F114C]">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>{pa.unbindAcknowledge}</span>
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-9 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858]"
          >
            {pa.cancel}
          </button>
          <button
            type="button"
            disabled={!acknowledged || unbind.isPending}
            onClick={submit}
            className="flex-1 h-9 rounded-lg bg-[#DD0C15] text-sm text-white font-medium disabled:opacity-50"
          >
            {unbind.isPending ? pa.unbindWorking : pa.unbindSubmit}
          </button>
        </div>
      </div>
    </Modal>
  );
}
