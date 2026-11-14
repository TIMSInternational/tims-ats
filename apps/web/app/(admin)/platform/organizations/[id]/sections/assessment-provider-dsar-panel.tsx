'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal, buttonClasses } from '../../../../../../components';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import {
  adminErrorCode,
  downloadJson,
  eraseCandidate,
  exportCandidate,
} from '../../../../../../lib/platform-api/assessment-provider-admin';

const candidateSchema = z.object({ candidateId: z.string().trim().uuid() });
type CandidateForm = z.infer<typeof candidateSchema>;

// DSAR for one candidate of this organization over the provider connector: the access export (downloaded as JSON for
// the platform owner to deliver to the data subject) and the erasure (asked of the provider; the ATS deletes the results
// it stores). Both are audited by C#. Erasure asks for confirmation first; an incomplete one can be retried safely.
export function AssessmentProviderDsarPanel({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const pa = t.providerAdmin;
  const form = useForm<CandidateForm>({ resolver: zodResolver(candidateSchema), defaultValues: { candidateId: '' } });
  const [busy, setBusy] = useState<'export' | 'erase' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmErase, setConfirmErase] = useState<string | null>(null);

  const explain = (error: unknown) => {
    const text = (pa.errors as Record<string, string>)[adminErrorCode(error)] ?? pa.errors.unknown;
    setMessage({ tone: 'error', text });
    toast(text, { type: 'error' });
  };

  const runExport = form.handleSubmit(async ({ candidateId }) => {
    setBusy('export');
    setMessage(null);
    try {
      const text = await exportCandidate(organizationId, candidateId);
      downloadJson(`tims-assessments-export-${candidateId}.json`, text);
      setMessage({ tone: 'ok', text: pa.exported });
    } catch (error) {
      explain(error);
    } finally {
      setBusy(null);
    }
  });

  const askErase = form.handleSubmit(({ candidateId }) => setConfirmErase(candidateId));

  const runErase = async (candidateId: string) => {
    setConfirmErase(null);
    setBusy('erase');
    setMessage(null);
    try {
      const answer = await eraseCandidate(organizationId, candidateId);
      const text = (answer.complete ? pa.erased : pa.eraseIncomplete)
        .replace('{requested}', String(answer.requested))
        .replace('{subjects}', String(answer.subjects));
      setMessage({ tone: answer.complete ? 'ok' : 'error', text });
    } catch (error) {
      explain(error);
    } finally {
      setBusy(null);
    }
  };

  const error = form.formState.errors.candidateId;
  return (
    <section aria-labelledby="provider-dsar-title" className="space-y-3" data-testid="provider-dsar-panel">
      <h4 id="provider-dsar-title" className="text-[13px] font-semibold text-[#1F114C]">
        {pa.dsarTitle}
      </h4>
      <p className="text-[12px] text-[#585858]">{pa.dsarHelp}</p>
      <form onSubmit={runExport} className="space-y-2" noValidate>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-[#585858] max-w-md">
          {pa.candidateLabel}
          <input
            {...form.register('candidateId')}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'provider-dsar-candidate-error' : undefined}
            className="h-9 rounded-lg border border-[#EDEDED] px-2 font-mono text-[12px]"
            autoComplete="off"
          />
        </label>
        {error && (
          <p id="provider-dsar-candidate-error" role="alert" className="text-[12px] text-[#B42318]">
            {pa.candidateInvalid}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy !== null}
            className={buttonClasses({ variant: 'secondary' })}
          >
            {busy === 'export' ? pa.exporting : pa.exportButton}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={askErase}
            className={buttonClasses({ variant: 'destructive-secondary' })}
          >
            {busy === 'erase' ? pa.erasing : pa.eraseButton}
          </button>
        </div>
      </form>
      <p
        aria-live="polite"
        className={message?.tone === 'error' ? 'text-callout text-danger' : 'text-callout text-success'}
      >
        {message?.text ?? ''}
      </p>
      {confirmErase && (
        <Modal title={pa.eraseConfirmTitle} onClose={() => setConfirmErase(null)} maxWidth="max-w-md">
          <p className="mb-4 text-body text-secondary">{pa.eraseConfirmBody.replace('{id}', confirmErase)}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmErase(null)}
              className={buttonClasses({ variant: 'secondary', className: 'flex-1' })}
            >
              {pa.cancel}
            </button>
            <button
              type="button"
              onClick={() => void runErase(confirmErase)}
              className={buttonClasses({ variant: 'destructive', className: 'flex-1' })}
            >
              {pa.eraseSubmit}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
