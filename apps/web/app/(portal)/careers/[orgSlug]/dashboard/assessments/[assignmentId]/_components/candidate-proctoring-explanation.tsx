'use client';

import { useRef, useState } from 'react';
import { useI18n } from '../../../../../../../../lib/i18n';
import { PlatformApiError, isPlatformApiEnabled } from '../../../../../../../../lib/platform-api/client';
import {
  useCandidateProctoringExplanation,
  useSubmitCandidateProctoringExplanation,
} from '../../../../../../../../lib/platform-api/proctoring';

interface CandidateProctoringExplanationProps {
  orgSlug: string;
  assignmentId: string;
}

export function CandidateProctoringExplanation({ orgSlug, assignmentId }: CandidateProctoringExplanationProps) {
  const { t, locale } = useI18n();
  const copy = t.proctoring.candidate.explanation;
  const [text, setText] = useState('');
  const submissionId = useRef<string | null>(null);
  const explanation = useCandidateProctoringExplanation({ orgSlug, assignmentId });
  const submit = useSubmitCandidateProctoringExplanation();
  const existing = submit.data ?? explanation.data?.explanation;
  const canSubmit = !existing && explanation.data?.canSubmit === true;
  const closesAt = explanation.data?.closesAt;

  if (!isPlatformApiEnabled()) return null;

  const formatTime = (value: string) => new Intl.DateTimeFormat(locale === 'ES' ? 'es' : 'en', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));

  return (
    <section className="border-t border-[#EDEDED] pt-5 text-left" aria-label={copy.title}>
      <h2 className="text-base font-semibold text-[#1F114C]">{copy.title}</h2>
      <p className="mt-1 text-[13px] text-[#585858]">{copy.description}</p>
      {explanation.isLoading ? <p className="mt-3 text-[13px]" role="status">{copy.loading}</p> : null}
      {explanation.isError ? (
        <div className="mt-3 space-y-2 text-[13px]">
          <p role="alert" className="text-[#B42318]">{copy.loadError}</p>
          <button type="button" onClick={() => void explanation.refetch()} className="font-medium text-[#493478] underline">
            {copy.retry}
          </button>
        </div>
      ) : null}
      {existing ? (
        <div className="mt-3 space-y-2 text-[13px]">
          <p className="font-medium text-[#1F114C]">{copy.submitted}</p>
          <p className="whitespace-pre-wrap break-words rounded-lg border border-[#EDEDED] bg-[#FAFAFA] p-3 text-[#585858]">
            {existing.text}
          </p>
          <p className="text-[#8B8B8B]">{copy.expiresAt}: {formatTime(existing.expiresAt)}</p>
        </div>
      ) : null}
      {canSubmit ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (submit.isPending || !text.trim()) return;
            submissionId.current ??= crypto.randomUUID();
            submit.mutate({ orgSlug, assignmentId, submissionId: submissionId.current, text: text.trim() });
          }}
        >
          {closesAt ? <p className="text-[12px] text-[#585858]">{copy.closesAt}: {formatTime(closesAt)}</p> : null}
          <label htmlFor="candidate-proctoring-explanation" className="block text-[13px] font-medium text-[#1F114C]">
            {copy.label}
          </label>
          <textarea
            id="candidate-proctoring-explanation"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            required
            rows={5}
            className="w-full rounded-lg border border-[#D1D5DB] bg-white p-3 text-[13px] text-[#1F114C]"
            placeholder={copy.placeholder}
          />
          <p className="text-[11px] text-[#8B8B8B]">{text.length}/2000 · {copy.oneTime}</p>
          {submit.isError ? (
            <p role="alert" className="text-[13px] text-[#B42318]">
              {submit.error instanceof PlatformApiError && [409, 410].includes(submit.error.status)
                ? copy.closed : copy.saveError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submit.isPending || !text.trim()}
            className="rounded-lg bg-[#1F114C] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {submit.isPending ? copy.saving : copy.submit}
          </button>
        </form>
      ) : null}
      {explanation.isSuccess && !existing && !explanation.data.canSubmit ? (
        <p className="mt-3 text-[13px] text-[#585858]" role="status">{copy.closed}</p>
      ) : null}
    </section>
  );
}
