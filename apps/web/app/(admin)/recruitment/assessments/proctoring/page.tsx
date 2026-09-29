'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { useProctoringCapability } from '../../../../../lib/platform-api/proctoring';
import { useProctoringReviewQueue } from '../../../../../lib/platform-api/proctoring-staff';
import { useProctoringStaffAccess } from '../../../../../lib/proctoring/staff-access';

export default function ProctoringReviewQueuePage() {
  const { t, locale } = useI18n();
  const capability = useProctoringCapability();
  const access = useProctoringStaffAccess();
  const queue = useProctoringReviewQueue(access.canRead && capability.data?.enabled === true);
  const labels = t.proctoring.queue;
  const rows = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const dateFormatter = new Intl.DateTimeFormat(locale === 'ES' ? 'es' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  if (access.isLoading) return <p role="status" className="p-6">{t.proctoring.review.loading}</p>;
  if (!access.canRead) return <p role="alert" className="p-6">{t.accessDenied.message}</p>;

  return (
    <main className="h-full overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-[#1F114C]">{labels.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#585858]">{labels.description}</p>
      </div>

      {capability.isLoading ? <p role="status">{t.proctoring.review.loading}</p> : null}
      {!capability.isLoading && !capability.data?.enabled ? (
        <p role="status" className="text-sm text-[#585858]">{labels.serviceUnavailable}</p>
      ) : null}
      {capability.data?.enabled && queue.isLoading ? <p role="status">{t.proctoring.review.loading}</p> : null}
      {capability.data?.enabled && queue.isError ? <p role="alert" className="text-sm text-[#B42318]">{labels.loadError}</p> : null}
      {capability.data?.enabled && !queue.isLoading && !queue.isError && rows.length === 0 ? (
        <p className="rounded-xl border border-[#EDEDED] bg-white p-6 text-sm text-[#585858]">{labels.empty}</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.sessionId} className="rounded-xl border border-[#EDEDED] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 text-sm text-[#585858]">
                  <p className="font-semibold text-[#1F114C]">
                    {row.candidate.firstName} {row.candidate.lastName}
                  </p>
                  <p>{labels.assessment}: {row.assessmentType.name}</p>
                  <p>{labels.flags}: {row.flagCount}</p>
                  <p>{labels.status}: {t.proctoring.review.status[row.reviewStatus]}</p>
                  {row.status === 'needs_attention' ? <p role="status">{labels.needsAttention}</p> : null}
                  {row.endedAt ? <p>{labels.completedAt}: {dateFormatter.format(new Date(row.endedAt))}</p> : null}
                </div>
                <Link
                  href={`/recruitment/candidates/${row.candidate.id}`}
                  className="rounded-lg bg-[#1F114C] px-3 py-2 text-xs font-medium text-white"
                >
                  {labels.openCandidate}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {queue.hasNextPage ? (
        <button
          type="button"
          onClick={() => void queue.fetchNextPage()}
          disabled={queue.isFetchingNextPage}
          className="mt-4 rounded-lg border border-[#D1D5DB] px-4 py-2 text-sm text-[#1F114C] disabled:opacity-50"
        >
          {labels.loadMore}
        </button>
      ) : null}
    </main>
  );
}
