'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatDateTime } from '../../../../lib/format-utils';
import { ErrorState, Skeleton, StatusBadge, TextInput, type StatusTone } from '../../../../components';

const CARD = 'flex flex-col rounded-xl bg-white p-5 shadow-card';
const CARD_TITLE = 'text-subheading font-semibold text-primary';

function connectorStatus(t: ReturnType<typeof useI18n>['t'], status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'connected':
    case 'active':
      return { label: t.integrations.statusConnected, tone: 'success' };
    case 'error':
      return { label: t.integrations.statusError, tone: 'danger' };
    case 'paused':
      return { label: t.integrations.statusPaused, tone: 'warning' };
    default:
      return { label: t.integrations.statusDisconnected, tone: 'neutral' };
  }
}

function CardSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function ActiveConnectors() {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const q = trpc.integration.listConnectors.useQuery();
  const all = q.data ?? [];
  const filtered = all.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <section aria-labelledby="integrations-connectors" className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="integrations-connectors" className={CARD_TITLE}>
          {t.integrations.connectors}
        </h2>
        {all.length > 0 && (
          <TextInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.integrations.searchConnector}
            aria-label={t.integrations.searchConnector}
            className="w-44"
          />
        )}
      </div>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {q.isLoading ? (
          <CardSkeleton />
        ) : q.isError ? (
          <ErrorState size="compact" title={t.integrations.connectorsErr} onRetry={() => q.refetch()} />
        ) : filtered.length === 0 ? (
          <p className="text-body text-secondary">{t.integrations.connectorsEmpty}</p>
        ) : (
          filtered.map((c) => {
            const st = connectorStatus(t, c.status);
            return (
              <div key={c.id} className="rounded-lg border border-border p-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <div
                    className="flex size-7 items-center justify-center rounded bg-brand-tint text-brand"
                    aria-hidden="true"
                  >
                    <span className="text-caption font-bold">{c.name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <span className="text-body font-medium text-primary">{c.name}</span>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-secondary">
                  <span>
                    {t.integrations.lastSync}: {formatDateTime(c.lastSyncAt, locale)}
                  </span>
                  <span className="tabular-nums">
                    {c.entitiesSynced} {t.integrations.entitiesSuffix}
                  </span>
                  {c.syncFrequency && <span>{c.syncFrequency}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
      {all.length > 0 && <p className="mt-3 text-caption text-secondary">{t.integrations.actionsComingSoon}</p>}
    </section>
  );
}

export function WebhooksConfig() {
  const { t, locale } = useI18n();
  const q = trpc.integration.listWebhooks.useQuery();

  return (
    <section aria-labelledby="integrations-webhooks" className={CARD}>
      <h2 id="integrations-webhooks" className={`mb-3 ${CARD_TITLE}`}>
        {t.integrations.webhooks}
      </h2>
      <div className="max-h-80 overflow-auto">
        {q.isLoading ? (
          <CardSkeleton />
        ) : q.isError ? (
          <ErrorState size="compact" title={t.integrations.webhooksErr} onRetry={() => q.refetch()} />
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-body text-secondary">{t.integrations.webhooksEmpty}</p>
        ) : (
          <table className="w-full text-callout">
            <thead>
              <tr className="border-b border-border text-secondary">
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.integrations.colEndpoint}
                </th>
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.integrations.colEvents}
                </th>
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.integrations.colStatus}
                </th>
                <th scope="col" className="pb-2 text-left font-semibold">
                  {t.integrations.colLastTrigger}
                </th>
              </tr>
            </thead>
            <tbody className="text-primary">
              {q.data.map((w) => (
                <tr key={w.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="max-w-40 truncate py-2 font-mono">{w.url}</td>
                  <td className="py-2">{Array.isArray(w.events) ? (w.events as string[]).join(', ') : ''}</td>
                  <td className="py-2">
                    <StatusBadge tone={w.isActive ? 'success' : 'warning'}>
                      {w.isActive ? t.integrations.active : t.integrations.inactive}
                    </StatusBadge>
                  </td>
                  <td className="py-2 text-secondary">{formatDateTime(w.lastTriggeredAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
