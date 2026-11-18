'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  BUTTON_GROUP_CLASSES,
  CHOICE_INPUT_CLASSES,
  FIELD_ERROR_CLASSES,
  FIELD_HELP_CLASSES,
  FIELD_LABEL_CLASSES,
  Modal,
  selectClasses,
  textareaClasses,
} from '../../../../components';
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
  /**
   * Bulk mode (pipeline table selection): every listed application is rejected with the same reason, note
   * and notification choice, one after the other. Without it, `applications` are the candidate's own
   * applications and the user rejects one of them.
   */
  bulk?: boolean;
}

export function RejectCandidateModal({
  candidateName,
  applications,
  onClose,
  onRejected,
  bulk = false,
}: RejectCandidateModalProps) {
  const { t } = useI18n();
  const m = t.rejectCandidateModal;
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  // The confirm step replaces the form inside the same dialog: move focus to it so its text is read.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const schema = useMemo(
    () =>
      z.object({
        applicationId: z.string().min(1).max(64),
        reasonCode: z.enum(REJECTION_REASON_CODES, { error: m.reasonRequired }),
        note: z.string().max(REJECTION_NOTE_MAX, m.noteTooLong.replace('{max}', String(REJECTION_NOTE_MAX))),
        notifyCandidate: z.boolean(),
      }),
    [m.reasonRequired, m.noteTooLong],
  );
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      applicationId: applications[0]?.id ?? '',
      reasonCode: undefined,
      note: '',
      notifyCandidate: false,
    },
  });
  const { errors } = form.formState;

  const refresh = () => Promise.all([utils.pipeline.getBoard.invalidate(), utils.candidate.invalidate()]);

  const reject = trpc.pipeline.rejectCandidate.useMutation({
    onSuccess: async (data, variables) => {
      const outcome = data?.candidateNotification;
      if (outcome === 'queued') toast(m.successNotified, { type: 'success' });
      else if (outcome === 'consent_withdrawn') toast(m.notNotifiedConsent, { type: 'warning', duration: 8000 });
      else if (outcome === 'failed') toast(m.notNotifiedFailed, { type: 'warning', duration: 8000 });
      else toast(m.success, { type: 'success' });
      await refresh();
      onRejected?.(variables.applicationId);
      onClose();
    },
    onError: (err) => {
      toast(err.message || m.error, { type: 'error' });
      setConfirming(false);
    },
  });

  // Bulk rejections run through their own mutation (no per-item toast / close callbacks).
  const rejectBulk = trpc.pipeline.rejectCandidate.useMutation();

  const reasonLabel = (code: RejectionReasonCode) => m.reasons[code];
  const values = form.watch();
  const isPending = reject.isPending || bulkRunning;

  // Sequential, so a failure in the middle leaves a clear count; each rejection is its own conditional write.
  const rejectAll = async (code: RejectionReasonCode, note: string, notify: boolean) => {
    setBulkRunning(true);
    let ok = 0;
    let notNotified = 0;
    for (const application of applications) {
      try {
        const input = toRejectCandidateInput(application.id, code, reasonLabel(code), note, notify);
        const result = await rejectBulk.mutateAsync(input);
        ok += 1;
        if (notify && result.candidateNotification !== 'queued') notNotified += 1;
        onRejected?.(application.id);
      } catch {
        // Counted below; the board refresh shows which ones are still active.
      }
    }
    setBulkRunning(false);
    const failed = applications.length - ok;
    if (failed === 0) toast(m.bulkDone.replace('{n}', String(ok)), { type: 'success' });
    else
      toast(
        m.bulkPartial
          .replace('{ok}', String(ok))
          .replace('{total}', String(applications.length))
          .replace('{failed}', String(failed)),
        { type: 'warning', duration: 8000 },
      );
    if (notNotified > 0)
      toast(m.bulkNotNotified.replace('{n}', String(notNotified)), { type: 'warning', duration: 8000 });
    await refresh();
    onClose();
  };

  const submit = form.handleSubmit((v) => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (bulk) {
      void rejectAll(v.reasonCode, v.note, v.notifyCandidate);
      return;
    }
    reject.mutate(
      toRejectCandidateInput(v.applicationId, v.reasonCode, reasonLabel(v.reasonCode), v.note, v.notifyCandidate),
    );
  });

  const count = String(applications.length);
  const title = bulk ? m.bulkTitle.replace('{n}', count) : m.title;
  const confirmText = values.reasonCode
    ? bulk
      ? m.bulkConfirmDesc.replace('{n}', count).replace('{reason}', reasonLabel(values.reasonCode))
      : m.confirmDesc.replace('{name}', candidateName).replace('{reason}', reasonLabel(values.reasonCode))
    : '';

  return (
    <Modal title={title} onClose={onClose}>
      <form noValidate onSubmit={submit} className="space-y-4">
        {confirming && values.reasonCode ? (
          <div aria-live="polite">
            <div
              ref={confirmRef}
              tabIndex={-1}
              role="group"
              aria-labelledby="reject-confirm-title"
              className="space-y-2 rounded-lg"
            >
              <p id="reject-confirm-title" className="text-heading font-semibold text-brand">
                {m.confirmTitle}
              </p>
              <p className="text-body text-secondary">{confirmText}</p>
              <p className="text-callout text-secondary">
                {values.notifyCandidate ? m.confirmWithEmail : m.confirmNoEmail}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-body text-secondary">{bulk ? m.bulkDescription : m.description}</p>
            {!bulk && applications.length > 1 && (
              <div>
                <label htmlFor="reject-application" className={FIELD_LABEL_CLASSES}>
                  {m.applicationLabel}
                </label>
                <select id="reject-application" className={selectClasses()} {...form.register('applicationId')}>
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.vacancyTitle}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="reject-reason" className={FIELD_LABEL_CLASSES}>
                {m.reasonLabel}
                <span aria-hidden="true" className="ml-0.5 text-danger">
                  *
                </span>
              </label>
              <select
                id="reject-reason"
                required
                aria-invalid={!!errors.reasonCode}
                aria-describedby={errors.reasonCode ? 'reject-reason-error' : undefined}
                className={selectClasses()}
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
                <p id="reject-reason-error" role="alert" className={FIELD_ERROR_CLASSES}>
                  {errors.reasonCode.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="reject-note" className={FIELD_LABEL_CLASSES}>
                {m.noteLabel}
              </label>
              <textarea
                id="reject-note"
                rows={3}
                maxLength={REJECTION_NOTE_MAX}
                placeholder={m.notePlaceholder}
                aria-invalid={!!errors.note}
                className={textareaClasses()}
                {...form.register('note')}
              />
              {errors.note && (
                <p role="alert" className={FIELD_ERROR_CLASSES}>
                  {errors.note.message}
                </p>
              )}
            </div>
            <div className="flex items-start gap-2">
              <input
                id="reject-notify"
                type="checkbox"
                aria-describedby="reject-notify-help"
                className={`mt-0.5 ${CHOICE_INPUT_CLASSES}`}
                {...form.register('notifyCandidate')}
              />
              <div>
                <label htmlFor="reject-notify" className="text-body font-medium text-primary">
                  {m.notifyLabel}
                </label>
                <p id="reject-notify-help" className={FIELD_HELP_CLASSES}>
                  {m.notifyHelp}
                </p>
              </div>
            </div>
          </>
        )}

        <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
          <Button variant="secondary" onClick={confirming ? () => setConfirming(false) : onClose} disabled={isPending}>
            {confirming ? m.back : t.common.cancel}
          </Button>
          {/* Red only on the step that destroys (alerts.md › Buttons): "Continuar" is a plain primary. */}
          <Button
            type="submit"
            variant={confirming ? 'destructive' : 'primary'}
            loading={isPending}
            loadingLabel={m.submitting}
          >
            {confirming ? (bulk ? m.bulkConfirm.replace('{n}', count) : m.confirm) : m.continue}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
