'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatDateTime } from '../../../../lib/format-utils';
import { ErrorState, Skeleton, StatusBadge } from '../../../../components';

const CARD = 'flex flex-col rounded-xl bg-white p-5 shadow-card';
const CARD_TITLE = 'text-subheading font-semibold text-primary';

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function ErrorLog() {
  const { t, locale } = useI18n();
  const q = trpc.integration.getErrorLog.useQuery({});
  const items = q.data?.items ?? [];

  return (
    <section aria-labelledby="integrations-error-log" className={CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="integrations-error-log" className={CARD_TITLE}>
          {t.integrations.errorLog}
        </h2>
        <span className="text-caption text-secondary">{t.integrations.last24h}</span>
      </div>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {q.isLoading ? (
          <ListSkeleton />
        ) : q.isError ? (
          <ErrorState size="compact" title={t.integrations.errorLogErr} onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-body text-secondary">{t.integrations.errorLogEmpty}</p>
        ) : (
          items.map((e) => (
            <div key={e.id} className="border-l-2 border-brand-red py-1 pl-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-callout font-medium text-primary">
                  {e.connector?.name} — {e.errorType}
                </span>
                {e.status === 'pending' ? (
                  <StatusBadge tone="warning">{t.integrations.errorStatusPending}</StatusBadge>
                ) : (
                  <StatusBadge tone="success">{t.integrations.errorStatusResolved}</StatusBadge>
                )}
              </div>
              <p className="mt-0.5 text-callout text-secondary">{e.message}</p>
              <div className="mt-1 flex items-center gap-3 text-caption text-secondary">
                <span>{formatDateTime(e.createdAt, locale)}</span>
                <span className="tabular-nums">
                  {t.integrations.retriesLabel}: {e.retryCount}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function SyncActivity() {
  const { t, locale } = useI18n();
  const q = trpc.integration.getRecentSyncs.useQuery({});

  return (
    <section aria-labelledby="integrations-sync-activity" className={CARD}>
      <h2 id="integrations-sync-activity" className={`mb-3 ${CARD_TITLE}`}>
        {t.integrations.syncActivity}
      </h2>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {q.isLoading ? (
          <ListSkeleton />
        ) : q.isError ? (
          <ErrorState size="compact" title={t.integrations.syncActivityErr} onRetry={() => q.refetch()} />
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-body text-secondary">{t.integrations.syncActivityEmpty}</p>
        ) : (
          q.data.map((s) => {
            const isError = s.status === 'error' || s.status === 'failed';
            return (
              <div key={s.id} className="flex items-center gap-2">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${isError ? 'bg-brand-red' : 'bg-success'}`}
                  aria-hidden="true"
                />
                <span className="shrink-0 text-caption text-secondary">{formatDateTime(s.startedAt, locale)}</span>
                <span className={`truncate text-callout ${isError ? 'text-danger' : 'text-primary'}`}>
                  <strong>{s.connector?.name}</strong> —{' '}
                  {isError ? (s.error ?? s.status) : `${s.entitiesProcessed} ${t.integrations.entitiesProcessed}`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
