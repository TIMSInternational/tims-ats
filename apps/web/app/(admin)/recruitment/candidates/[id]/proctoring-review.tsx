'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { useProctoringCapability } from '../../../../../lib/platform-api/proctoring';
import { useProctoringEvidence, useReviewProctoring } from '../../../../../lib/platform-api/proctoring-staff';
import { PlatformApiError } from '../../../../../lib/platform-api/client';
import { useProctoringStaffAccess } from '../../../../../lib/proctoring/staff-access';

interface ProctoringReviewProps {
  assignmentId: string;
}

type ReviewDecision = 'clear' | 'concern' | 'inconclusive';

export function ProctoringReview({ assignmentId }: ProctoringReviewProps) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const access = useProctoringStaffAccess();

  if (!access.canRead) return null;

  return (
    <section className="mt-3 rounded-lg border border-[#EDEDED] bg-[#FAFAFA]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-[#1F114C]"
      >
        <span>{t.proctoring.review.title}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? <ProctoringReviewContent assignmentId={assignmentId} canWrite={access.canWrite} /> : null}
    </section>
  );
}

function ProctoringReviewContent({ assignmentId, canWrite }: ProctoringReviewProps & { canWrite: boolean }) {
  const { t, locale } = useI18n();
  const [decision, setDecision] = useState<ReviewDecision>('inconclusive');
  const [notes, setNotes] = useState('');
  const capability = useProctoringCapability();
  const session = useProctoringEvidence(assignmentId, capability.data?.enabled === true);
  const review = useReviewProctoring();
  const labels = t.proctoring.review;
  const summary = session.data?.pages[0];
  const events = session.data?.pages.flatMap((page) => page.events) ?? [];

  const formatTime = (date: Date | string) =>
    new Intl.DateTimeFormat(locale === 'ES' ? 'es' : 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(date));

  return (
    <div className="space-y-3 border-t border-[#EDEDED] p-3 text-xs text-[#585858]">
      {capability.isLoading ? <p>{labels.loading}</p> : null}
      {!capability.isLoading && !capability.data?.enabled ? <p role="status">{labels.serviceUnavailable}</p> : null}
      {capability.data?.enabled && session.isLoading ? <p>{labels.loading}</p> : null}
      {capability.data?.enabled && session.isError ? (
        <p role="status">{session.error instanceof PlatformApiError && session.error.status === 404 ? labels.noSession : labels.loadError}</p>
      ) : null}
      {summary ? (
        <>
          <p className="text-[11px]">{labels.signalsOnly}</p>
          <div className="flex flex-wrap gap-2">
            <span className="rounded bg-white px-2 py-1">{labels.status[summary.review.status]}</span>
            <span className="rounded bg-white px-2 py-1">
              {summary.flagCount} {labels.events}
            </span>
          </div>
          <p>
            {labels.startedAt}: {formatTime(summary.startedAt)}
          </p>
          {summary.endedAt ? (
            <p>
              {labels.endedAt}: {formatTime(summary.endedAt)}
            </p>
          ) : null}
          {events.length === 0 ? (
            <p>{labels.noEvents}</p>
          ) : (
            <ol className="max-h-56 space-y-2 overflow-y-auto" aria-label={labels.title}>
              {events.map((event) => (
                <li key={event.id} className="rounded border border-[#EDEDED] bg-white px-3 py-2">
                  <span className="font-medium text-[#1F114C]">
                    {labels.eventType[event.type as keyof typeof labels.eventType] ?? event.type}
                  </span>
                  <span className="ml-2 text-[11px]">{formatTime(event.occurredAt)}</span>
                </li>
              ))}
            </ol>
          )}
          {session.hasNextPage ? (
            <button
              type="button"
              disabled={session.isFetchingNextPage}
              onClick={() => void session.fetchNextPage()}
              className="rounded border border-[#D1D5DB] px-3 py-2 text-[#1F114C] disabled:opacity-50"
            >
              {labels.loadMore}
            </button>
          ) : null}
          {summary.review.reviewedAt ? (
            <p>
              {labels.status[summary.review.status]} · {formatTime(summary.review.reviewedAt)}
              {summary.review.notes ? ` — ${summary.review.notes}` : ''}
            </p>
          ) : null}
          {summary.status === 'active' ? <p role="status">{labels.activeSession}</p> : canWrite ? <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              review.mutate({ assignmentId, status: decision, notes: notes.trim() || undefined });
            }}
          >
            <select
              aria-label={labels.title}
              value={decision}
              onChange={(event) => setDecision(event.target.value as ReviewDecision)}
              className="w-full rounded border border-[#D1D5DB] bg-white px-2 py-2"
            >
              <option value="inconclusive">{labels.status.inconclusive}</option>
              <option value="clear">{labels.status.clear}</option>
              <option value="concern">{labels.status.concern}</option>
            </select>
            <textarea
              aria-label={labels.notes}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              required={decision !== 'clear'}
              maxLength={2000}
              rows={3}
              className="w-full rounded border border-[#D1D5DB] bg-white px-2 py-2"
              placeholder={labels.notes}
            />
            {review.isError ? (
              <p role="alert" className="text-[#B42318]">
                {labels.saveError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={review.isPending}
              className="rounded bg-[#1F114C] px-3 py-2 font-medium text-white disabled:opacity-50"
            >
              {labels.save}
            </button>
          </form> : null}
        </>
      ) : null}
    </div>
  );
}
