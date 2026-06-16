'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ApiKeyManager() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.integration.listApiKeys.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'staging' | 'development'>('production');
  const [scopes, setScopes] = useState('assessment:read');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = trpc.integration.createApiKey.useMutation({
    onSuccess: (res) => {
      setRawKey(res.key);
      setShowCreate(false);
      setName('');
      setScopes('assessment:read');
      void utils.integration.listApiKeys.invalidate();
      toast(t.integrations.apiKeyCreated, { type: 'success' });
    },
    onError: () => toast(t.integrations.apiKeysErr, { type: 'error' }),
  });

  const revoke = trpc.integration.revokeApiKey.useMutation({
    onSuccess: () => {
      void utils.integration.listApiKeys.invalidate();
      toast(t.integrations.apiKeyRevoked, { type: 'success' });
    },
    onError: () => toast(t.integrations.apiKeysErr, { type: 'error' }),
  });

  function submitCreate() {
    const parsed = scopes.split(',').map((s) => s.trim()).filter(Boolean);
    if (parsed.length > 20) {
      toast(t.integrations.apiKeysErr, { type: 'error' });
      return;
    }
    create.mutate({ name: name.trim(), environment, scopes: parsed });
  }

  function copyKey() {
    if (!rawKey) return;
    navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.integrations.apiKeys}</h3>
        <button
          onClick={() => setShowCreate(true)}
          className="text-[11px] font-medium text-white bg-[#1F114C] rounded-md px-2.5 py-1"
        >
          {t.integrations.newApiKey}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.isLoading ? (
          <div className="h-12 bg-gray-50 rounded animate-pulse" />
        ) : list.isError ? (
          <p className="text-[12px] text-[#DD0C15]">{t.integrations.apiKeysErr}</p>
        ) : !list.data || list.data.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.integrations.apiKeysEmpty}</p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                <th className="text-left pb-1.5 font-medium">{t.integrations.colApiKey}</th>
                <th className="text-left pb-1.5 font-medium">{t.integrations.colEnv}</th>
                <th className="text-left pb-1.5 font-medium">{t.integrations.colCreated}</th>
                <th className="text-right pb-1.5 font-medium">{t.integrations.apiKeyActions}</th>
              </tr>
            </thead>
            <tbody className="text-[#333]">
              {list.data.map((k) => (
                <tr key={k.id} className="border-b border-[#F6F6F6]">
                  <td className="py-1.5 font-mono text-[9px]">{k.keyPrefix}…</td>
                  <td className="py-1.5">{k.environment}</td>
                  <td className="py-1.5 text-[#8B8B8B]">{fmtDate(k.createdAt)}</td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => {
                        if (window.confirm(t.integrations.apiKeyRevokeConfirm)) revoke.mutate({ id: k.id });
                      }}
                      className="text-[10px] text-[#DD0C15] font-medium"
                    >
                      {t.integrations.apiKeyRevoke}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-5 w-[360px] space-y-3">
            <h4 className="text-[14px] font-semibold text-[#1F114C]">{t.integrations.newApiKey}</h4>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.integrations.apiKeyName}
              className="w-full border border-[#EDEDED] rounded-md px-2.5 py-1.5 text-[12px]"
            />
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as typeof environment)}
              className="w-full border border-[#EDEDED] rounded-md px-2.5 py-1.5 text-[12px]"
            >
              <option value="production">production</option>
              <option value="staging">staging</option>
              <option value="development">development</option>
            </select>
            <input
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              placeholder={t.integrations.apiKeyScopes}
              className="w-full border border-[#EDEDED] rounded-md px-2.5 py-1.5 text-[12px] font-mono"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowCreate(false)}
                className="text-[12px] text-[#8B8B8B] px-3 py-1.5"
              >
                {t.integrations.apiKeyCancel}
              </button>
              <button
                onClick={submitCreate}
                disabled={!name.trim() || create.isPending}
                className="text-[12px] text-white bg-[#1F114C] rounded-md px-3 py-1.5 disabled:opacity-50"
              >
                {t.integrations.apiKeyCreate}
              </button>
            </div>
          </div>
        </div>
      )}

      {rawKey && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-5 w-[420px] space-y-3">
            <h4 className="text-[14px] font-semibold text-[#1F114C]">{t.integrations.apiKeyCreated}</h4>
            <p className="text-[11px] text-[#DD0C15]">{t.integrations.apiKeyCopyWarn}</p>
            <code className="block bg-[#F6F6F6] rounded-md px-2.5 py-2 text-[10px] font-mono break-all">
              {rawKey}
            </code>
            <div className="flex justify-end gap-2">
              <button
                onClick={copyKey}
                className="text-[12px] text-[#1F114C] border border-[#1F114C] rounded-md px-3 py-1.5"
              >
                {copied ? t.integrations.apiKeyCopied : t.integrations.apiKeyCopy}
              </button>
              <button
                onClick={() => setRawKey(null)}
                className="text-[12px] text-white bg-[#1F114C] rounded-md px-3 py-1.5"
              >
                {t.integrations.apiKeyClose}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
