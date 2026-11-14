'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { intlLocale } from '../../../../lib/format-utils';
import { Button, ConfirmDialog, ErrorState, Skeleton } from '../../../../components';
import { ApiKeyCreateModal } from './api-key-create-modal';
import { ApiKeySecretDialog } from './api-key-secret-dialog';

interface ApiKeyManagerProps {
  /** The create dialog is opened from the page header's primary action. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

export function ApiKeyManager({ createOpen, onCreateOpenChange }: ApiKeyManagerProps) {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.integration.listApiKeys.useQuery();
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; prefix: string } | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const envLabel: Record<string, string> = {
    production: t.integrations.apiKeyEnvProduction,
    staging: t.integrations.apiKeyEnvStaging,
    development: t.integrations.apiKeyEnvDevelopment,
  };
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium' });

  const create = trpc.integration.createApiKey.useMutation({
    onSuccess: (res) => {
      setRawKey(res.key);
      onCreateOpenChange(false);
      void utils.integration.listApiKeys.invalidate();
    },
    onError: () => setCreateError(t.integrations.apiKeyCreateError),
  });

  const revoke = trpc.integration.revokeApiKey.useMutation({
    onSuccess: () => {
      setRevokeTarget(null);
      void utils.integration.listApiKeys.invalidate();
      toast(t.integrations.apiKeyRevoked, { type: 'success' });
    },
    onError: () => setRevokeError(t.integrations.apiKeyRevokeError),
  });

  function closeCreate() {
    setCreateError(null);
    onCreateOpenChange(false);
  }

  return (
    <section aria-labelledby="api-keys-title" className="flex flex-col rounded-xl bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="api-keys-title" className="text-subheading font-semibold text-primary">
          {t.integrations.apiKeys}
        </h2>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {list.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : list.isError ? (
          <ErrorState size="compact" title={t.integrations.apiKeysErr} onRetry={() => list.refetch()} />
        ) : !list.data || list.data.length === 0 ? (
          <div className="space-y-3">
            <p className="text-body text-secondary">{t.integrations.apiKeysEmpty}</p>
            <Button variant="secondary" size="sm" onClick={() => onCreateOpenChange(true)}>
              {t.integrations.newApiKey}
            </Button>
          </div>
        ) : (
          <table className="w-full text-callout">
            <thead>
              <tr className="border-b border-border text-secondary">
                <th scope="col" className="pb-1.5 text-left font-semibold">
                  {t.integrations.colApiKey}
                </th>
                <th scope="col" className="pb-1.5 text-left font-semibold">
                  {t.integrations.colEnv}
                </th>
                <th scope="col" className="pb-1.5 text-left font-semibold">
                  {t.integrations.colCreated}
                </th>
                <th scope="col" className="pb-1.5 text-right font-semibold">
                  <span className="sr-only">{t.integrations.apiKeyActions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="text-primary">
              {list.data.map((k) => (
                <tr key={k.id} className="border-b border-border-subtle">
                  <td className="py-2 font-mono">{k.keyPrefix}…</td>
                  <td className="py-2">{envLabel[k.environment] ?? k.environment}</td>
                  <td className="py-2 text-secondary">{k.createdAt ? dateFmt.format(new Date(k.createdAt)) : '—'}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="destructive-secondary"
                      size="sm"
                      onClick={() => {
                        setRevokeError(null);
                        setRevokeTarget({ id: k.id, prefix: k.keyPrefix });
                      }}
                    >
                      {t.integrations.apiKeyRevoke}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <ApiKeyCreateModal
          pending={create.isPending}
          error={createError}
          onClose={closeCreate}
          onSubmit={(input) => {
            setCreateError(null);
            create.mutate(input);
          }}
        />
      )}

      {rawKey && <ApiKeySecretDialog rawKey={rawKey} onClose={() => setRawKey(null)} />}

      {revokeTarget && (
        <ConfirmDialog
          title={formatMessage(t.integrations.apiKeyRevokeTitle, { prefix: revokeTarget.prefix })}
          description={t.integrations.apiKeyRevokeConfirm}
          confirmLabel={t.integrations.apiKeyRevokeAction}
          confirmingLabel={t.integrations.apiKeyRevoking}
          destructive
          loading={revoke.isPending}
          error={revokeError}
          onConfirm={() => revoke.mutate({ id: revokeTarget.id })}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </section>
  );
}
