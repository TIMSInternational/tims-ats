'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { Button, EmptyState, PageHeader } from '../../../../components';
import { IntegrationKpis } from './integration-kpis';
import { ActiveConnectors, WebhooksConfig } from './integration-connectors';
import { ErrorLog, SyncActivity } from './integration-right-column';
import { ApiKeyManager } from './api-keys-manager';
import { AuditLogLink } from './integration-bottom';

export default function IntegrationsPage() {
  const { t } = useI18n();
  const kpis = trpc.integration.getDashboardKpis.useQuery();
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const d = kpis.data;
  // Nothing connected: one empty state instead of four zero tiles and four "Sin …" cards. The cards stay
  // mounted (hidden) so the page makes exactly the same requests.
  const nothingConnected =
    !!d && d.connectorCount === 0 && d.activeWebhooks === 0 && d.pendingErrors === 0 && d.recentSyncs === 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader
        title={t.integrations.title}
        description={t.integrations.description}
        actions={
          <Button
            onClick={() => setCreateKeyOpen(true)}
            icon={
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            {t.integrations.newApiKey}
          </Button>
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {nothingConnected && (
          <div className="rounded-xl bg-white shadow-card">
            <EmptyState title={t.integrations.emptyTitle} description={t.integrations.emptyDescription} />
          </div>
        )}

        <div className={nothingConnected ? 'hidden' : 'space-y-4'}>
          <IntegrationKpis
            data={d ?? null}
            loading={kpis.isLoading}
            isError={kpis.isError}
            onRetry={() => kpis.refetch()}
          />
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="flex w-full flex-col gap-4 md:w-[55%]">
              <ActiveConnectors />
              <WebhooksConfig />
            </div>
            <div className="flex w-full flex-col gap-4 md:w-[45%]">
              <ErrorLog />
              <SyncActivity />
            </div>
          </div>
        </div>

        <ApiKeyManager createOpen={createKeyOpen} onCreateOpenChange={setCreateKeyOpen} />
        <AuditLogLink />
      </div>
    </div>
  );
}
