'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { Modal } from '../../../../components';

const FLAG_DESCRIPTIONS: Record<string, string> = {
  ai_enabled: 'Habilita funcionalidades de IA (screening, matching, sugerencias)',
  nine_box_enabled: 'Modulo de Nine-Box / Talent Review para evaluacion de talento',
  dei_enabled: 'Modulo de Diversidad, Equidad e Inclusion con analytics',
  compensation_enabled: 'Modulo de Compensacion y Beneficios con benchmarking',
  succession_enabled: 'Planificacion de sucesion y mapa de talento',
  video_interviews: 'Entrevistas en video con grabacion y transcripcion AI',
  whatsapp_enabled: 'Integracion con WhatsApp Business para comunicacion candidatos',
  advanced_analytics: 'Analytics avanzados con dashboards personalizables y exportacion',
  api_access: 'Acceso a API REST publica con API keys y rate limiting',
  sso_saml: 'Single Sign-On via SAML 2.0 para integracion empresarial',
};

export default function PlatformFeatureFlagsPage() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data: flagGroups, isLoading } = trpc.platform.listAllFeatureFlags.useQuery();

  const [localToggles, setLocalToggles] = useState<Record<string, boolean>>({});
  const [selectedFlagKey, setSelectedFlagKey] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [newFlagKey, setNewFlagKey] = useState('');
  const [newFlagEnabled, setNewFlagEnabled] = useState(false);

  const flags = flagGroups ?? [];
  const activeFlagKey = selectedFlagKey || (flags.length > 0 ? flags[0].key : '');
  const selectedFlagEntries = useMemo(() => {
    const group = flags.find(f => f.key === activeFlagKey);
    return group?.entries ?? [];
  }, [flags, activeFlagKey]);

  const invalidateAll = () => {
    utils.platform.listAllFeatureFlags.invalidate();
  };

  const updateFlag = trpc.platform.updateFeatureFlag.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.featureFlags.updated, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const seedFlags = trpc.platform.seedFeatureFlags.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.featureFlags.seedSuccess, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const createFlag = trpc.platform.createFeatureFlagForAllOrgs.useMutation({
    onSuccess: () => { invalidateAll(); setShowCreateModal(false); setNewFlagKey(''); toast(t.featureFlags.flagCreated, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const deleteFlag = trpc.platform.deleteFeatureFlagByKey.useMutation({
    onSuccess: () => { invalidateAll(); setDeleteTarget(null); toast(t.featureFlags.flagDeleted, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  function handleToggle(orgId: string, key: string, currentEnabled: boolean) {
    const newEnabled = !currentEnabled;
    setLocalToggles(prev => ({ ...prev, [`${orgId}:${key}`]: newEnabled }));
    updateFlag.mutate({ organizationId: orgId, key, enabled: newEnabled });
  }

  function getEffectiveEnabled(orgId: string, key: string, dbEnabled: boolean): boolean {
    const toggleKey = `${orgId}:${key}`;
    if (toggleKey in localToggles) return localToggles[toggleKey];
    return dbEnabled;
  }

  const isEmpty = flags.length === 0;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 animate-pulse h-[52px]" />
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-8 text-center">
          <p className="text-[13px] text-[#8B8B8B]">{t.featureFlags.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center gap-3">
        <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <p className="text-[12px] text-blue-700 flex-1">{t.featureFlags.infoBanner}</p>
        <div className="flex items-center gap-2 shrink-0">
          {isEmpty && (
            <button onClick={() => seedFlags.mutate()} disabled={seedFlags.isPending} className="h-8 px-4 text-[12px] font-medium bg-[#1F114C] text-white rounded-lg hover:bg-[#2a1866] disabled:opacity-50 transition">
              {seedFlags.isPending ? t.featureFlags.seeding : t.featureFlags.seedFlags}
            </button>
          )}
          <button onClick={() => setShowCreateModal(true)} className="h-8 px-4 text-[12px] font-medium bg-[#1F114C] text-white rounded-lg hover:bg-[#2a1866] transition flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" /></svg>
            {t.featureFlags.createFlag}
          </button>
        </div>
      </div>

      {/* Feature Flags Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden mb-4">
        {isEmpty ? (
          <div className="p-12 text-center">
            <svg className="w-10 h-10 mx-auto mb-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
            </svg>
            <p className="text-[13px] text-[#8B8B8B]">{t.featureFlags.noFlags}</p>
            <p className="text-[11px] text-[#ABABAB] mt-1">{t.featureFlags.noFlagsDesc}</p>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-[#EDEDED]">
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.featureFlags.flagKey}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.featureFlags.description}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider text-center">{t.featureFlags.orgsActive}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider text-center">{t.featureFlags.overrides}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.featureFlags.lastModified}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.featureFlags.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F3F3]">
              {flags.map(group => {
                const enabledCount = group.entries.filter(e => e.enabled).length;
                const totalEntries = group.entries.length;
                const description = FLAG_DESCRIPTIONS[group.key] || t.featureFlags.customFlag;

                return (
                  <tr key={group.key} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-3">
                      <code className="text-[12px] font-mono bg-[#F0EEF7] text-[#1F114C] px-2 py-0.5 rounded">{group.key}</code>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#585858]">{description}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${enabledCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{enabledCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${totalEntries > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>{totalEntries}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#8B8B8B]">{group.latestUpdate ? formatDate(group.latestUpdate) : '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setSelectedFlagKey(group.key)} className={`px-2 py-1 text-[10px] rounded font-medium ${activeFlagKey === group.key ? 'text-white bg-[#1F114C]' : 'text-[#1F114C] bg-[#F0EEF7] hover:bg-[#E4E0F0]'}`}>
                          {t.featureFlags.configure}
                        </button>
                        <button onClick={() => setDeleteTarget(group.key)} className="px-2 py-1 text-[10px] text-[#DD0C15] bg-red-50 rounded font-medium hover:bg-red-100">
                          {t.featureFlags.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {/* Override Panel */}
      {activeFlagKey && selectedFlagEntries.length > 0 && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#EDEDED] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
              <p className="text-[13px] font-semibold text-[#1F114C]">{t.featureFlags.overrideByOrg}</p>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F0EEF7] text-[#1F114C]">{activeFlagKey}</span>
            </div>
            <select className="h-8 px-3 border border-[#EDEDED] rounded-lg text-[12px] bg-white text-[#585858] focus:outline-none" value={activeFlagKey} onChange={e => setSelectedFlagKey(e.target.value)}>
              {flags.map(f => <option key={f.key} value={f.key}>{f.key}</option>)}
            </select>
          </div>
          <div className="divide-y divide-[#F3F3F3]">
            {selectedFlagEntries.map(entry => {
              const effectiveEnabled = getEffectiveEnabled(entry.organizationId, entry.key, entry.enabled);
              const orgName = entry.organization?.name || 'Organizacion';
              const orgInitials = orgName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
              const orgPlan = entry.organization?.plan || 'trial';
              const userCount = entry.organization?._count?.users ?? 0;

              return (
                <div key={entry.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold">{orgInitials}</div>
                    <div>
                      <p className="text-[13px] font-medium text-[#1F114C]">{orgName}</p>
                      <p className="text-[10px] text-[#8B8B8B]">Plan {orgPlan.charAt(0).toUpperCase() + orgPlan.slice(1)} — {userCount} {t.featureFlags.users}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-[11px] font-medium ${effectiveEnabled ? 'text-green-600' : 'text-[#DD0C15]'}`}>
                      {effectiveEnabled ? t.featureFlags.enabled : t.featureFlags.disabled}
                    </span>
                    <button onClick={() => handleToggle(entry.organizationId, entry.key, effectiveEnabled)} className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${effectiveEnabled ? 'bg-[#1F114C]' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${effectiveEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeFlagKey && selectedFlagEntries.length === 0 && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-8 text-center">
          <p className="text-[13px] text-[#8B8B8B]">{t.featureFlags.noOverrides}</p>
          <p className="text-[11px] text-[#ABABAB] mt-1">{t.featureFlags.noOverridesDesc}</p>
        </div>
      )}

      {/* Create Flag Modal */}
      {showCreateModal && (
        <Modal title={t.featureFlags.createFlagTitle} onClose={() => setShowCreateModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[#585858] mb-1 block">{t.featureFlags.flagKeyLabel}</label>
              <input
                type="text"
                value={newFlagKey}
                onChange={e => setNewFlagKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="my_feature_flag"
                className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#585858]">{t.featureFlags.enabledByDefault}</label>
              <button onClick={() => setNewFlagEnabled(!newFlagEnabled)} className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${newFlagEnabled ? 'bg-[#1F114C]' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${newFlagEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="text-[10px] text-[#8B8B8B]">{t.featureFlags.createForAllOrgs}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreateModal(false)} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.common.cancel}</button>
              <button onClick={() => createFlag.mutate({ key: newFlagKey, enabled: newFlagEnabled })} disabled={!newFlagKey || createFlag.isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">
                {createFlag.isPending ? t.common.saving : t.common.create}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <Modal title={t.featureFlags.confirmDelete} onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-red-50">
              <p className="text-sm text-[#DD0C15]">{t.featureFlags.confirmDeleteDesc}</p>
              <code className="text-xs font-mono text-[#DD0C15] mt-1 block">{deleteTarget}</code>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDeleteTarget(null)} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.common.cancel}</button>
              <button onClick={() => deleteFlag.mutate({ key: deleteTarget })} disabled={deleteFlag.isPending} className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                {deleteFlag.isPending ? t.common.saving : t.featureFlags.delete}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
