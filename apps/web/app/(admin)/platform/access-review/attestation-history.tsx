'use client';

import { useI18n } from '../../../../lib/i18n';
import { intlLocale } from '../../../../lib/format-utils';
import { EmptyState, ErrorState, Skeleton } from '../../../../components';
import type { useAccessReviewAttestations } from '../../../../lib/platform-api/access-review';

type HistoryQuery = ReturnType<typeof useAccessReviewAttestations>;

const TH = 'px-5 py-3 text-left text-callout font-medium text-secondary';

/** Past certifications of the selected organization, newest first. */
export function AttestationHistory({ history }: { history: HistoryQuery }) {
  const { t, locale } = useI18n();
  const ar = t.accessReview;
  const attestations = history.data ?? [];
  const dateFormat = new Intl.DateTimeFormat(intlLocale(locale), { year: 'numeric', month: 'short', day: '2-digit' });

  return (
    <section aria-labelledby="attestation-history-title" className="overflow-hidden rounded-xl bg-white shadow-card">
      <div className="border-b border-border px-5 py-3">
        <h2 id="attestation-history-title" className="text-heading font-semibold text-brand">
          {ar.historyTitle}
        </h2>
      </div>
      {history.isLoading ? (
        <div aria-busy="true" className="space-y-3 p-5">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : history.isError ? (
        <ErrorState
          size="compact"
          onRetry={() => history.refetch()}
          error={history.error}
          message={ar.historyLoadError}
        />
      ) : attestations.length === 0 ? (
        <EmptyState size="compact" title={ar.historyEmpty} description={ar.historyEmptyDesc} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>{ar.historyColDate}</th>
                <th className={TH}>{ar.historyColReviewer}</th>
                <th className={TH}>{ar.historyColUsers}</th>
                <th className={TH}>{ar.historyColPrivileged}</th>
                <th className={TH}>{ar.historyColNotes}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attestations.map((a) => (
                <tr key={a.id} className="hover:bg-surface-hover">
                  <td className="whitespace-nowrap px-5 py-3 text-body text-secondary">
                    {dateFormat.format(a.reviewedAt)}
                  </td>
                  <td className="px-5 py-3 text-body text-primary">
                    {a.reviewer.firstName} {a.reviewer.lastName}
                  </td>
                  <td className="px-5 py-3 text-body tabular-nums text-primary">{a.userCount}</td>
                  <td className="px-5 py-3 text-body tabular-nums text-primary">{a.privilegedCount}</td>
                  <td
                    className="max-w-[240px] truncate px-5 py-3 text-body text-secondary"
                    title={a.notes ?? undefined}
                  >
                    {a.notes ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
