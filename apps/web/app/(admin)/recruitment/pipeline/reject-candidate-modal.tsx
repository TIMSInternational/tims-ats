'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import {
  REJECTION_NOTE_MAX,
  REJECTION_REASON_CODES,
  toRejectCandidateInput,
  type RejectionReasonCode,
} from '../../../../lib/reject-reasons';

export interface RejectableApplication {
  id: string;
  vacancyTitle: string;
}

interface RejectCandidateModalProps {
  candidateName: string;
  applications: RejectableApplication[];
  onClose: () => void;
  onRejected?: (applicationId: string) => void;
}

const FIELD_CLS =
  'w-full rounded-lg border border-[#EDEDED] bg-white px-3 text-[13px] focus:border-[#1F114C] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20';
const LABEL_CLS = 'mb-1.5 block text-[12px] font-medium text-[#585858]';

export function RejectCandidateModal({ candidateName, applications, onClose, onRejected }: RejectCandidateModalProps) {
  const { t } = useI18n();
  const m = t.rejectCandidateModal;
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        applicationId: z.string().min(1).max(64),
        reasonCode: z.enum(REJECTION_REASON_CODES, { error: m.reasonRequired }),
        note: z.string().max(REJECTION_NOTE_MAX, m.noteTooLong.replace('{max}', String(REJECTION_NOTE_MAX))),
      }),
    [m.reasonRequired, m.noteTooLong],
  );
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { applicationId: applications[0]?.id ?? '', reasonCode: undefined, note: '' },
  });
  const { errors } = form.formState;

  const reject = trpc.pipeline.rejectCandidate.useMutation({
    onSuccess: async (_data, variables) => {
      toast(m.success, { type: 'success' });
      await Promise.all([utils.pipeline.getBoard.invalidate(), utils.candidate.invalidate()]);
      onRejected?.(variables.applicationId);
      onClose();
    },
    onError: (err) => {
      toast(err.message || m.error, { type: 'error' });
      setConfirming(false);
    },
  });

  const reasonLabel = (code: RejectionReasonCode) => m.reasons[code];
  const values = form.watch();

  const submit = form.handleSubmit((v) => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    reject.mutate(toRejectCandidateInput(v.applicationId, v.reasonCode, reasonLabel(v.reasonCode), v.note));
  });

  return (
    <Modal title={m.title} onClose={onClose}>
      <form noValidate onSubmit={submit} className="space-y-4">
        {confirming && values.reasonCode ? (
          <div role="alertdialog" aria-labelledby="reject-confirm-title" className="space-y-2">
            <p id="reject-confirm-title" className="text-[14px] font-semibold text-[#1F114C]">
              {m.confirmTitle}
            </p>
            <p className="text-[13px] text-[#585858]">
              {m.confirmDesc.replace('{name}', candidateName).replace('{reason}', reasonLabel(values.reasonCode))}
            </p>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-[#585858]">{m.description}</p>
            {applications.length > 1 && (
              <div>
                <label htmlFor="reject-application" className={LABEL_CLS}>
                  {m.applicationLabel}
                </label>
                <select id="reject-application" className={`${FIELD_CLS} h-9`} {...form.register('applicationId')}>
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.vacancyTitle}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="reject-reason" className={LABEL_CLS}>
                {m.reasonLabel} *
              </label>
              <select
                id="reject-reason"
                aria-invalid={!!errors.reasonCode}
                aria-describedby={errors.reasonCode ? 'reject-reason-error' : undefined}
                className={`${FIELD_CLS} h-9`}
                {...form.register('reasonCode')}
              >
                <option value="">{m.reasonPlaceholder}</option>
                {REJECTION_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {reasonLabel(code)}
                  </option>
                ))}
              </select>
              {errors.reasonCode && (
                <p id="reject-reason-error" role="alert" className="mt-1 text-[11px] text-red-600">
                  {errors.reasonCode.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="reject-note" className={LABEL_CLS}>
                {m.noteLabel}
              </label>
              <textarea
                id="reject-note"
                rows={3}
                maxLength={REJECTION_NOTE_MAX}
                placeholder={m.notePlaceholder}
                className={`${FIELD_CLS} py-2`}
                {...form.register('note')}
              />
              {errors.note && (
                <p role="alert" className="mt-1 text-[11px] text-red-600">
                  {errors.note.message}
                </p>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={confirming ? () => setConfirming(false) : onClose}
            disabled={reject.isPending}
            className="h-9 rounded-lg border border-[#EDEDED] px-4 text-[13px] text-[#585858] hover:bg-[#F6F6F6]"
          >
            {confirming ? m.back : t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={reject.isPending}
            className="h-9 rounded-lg bg-[#DD0C15] px-4 text-[13px] font-semibold text-white hover:bg-[#b80a12] disabled:opacity-50"
          >
            {reject.isPending ? m.submitting : confirming ? m.confirm : m.continue}
          </button>
        </div>
      </form>
    </Modal>
  );
}
