'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';

// Descriptions for known flag keys (matches HTML mockup)
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
  const utils = trpc.useUtils();
  const { data: flagGroups, isLoading } = trpc.platform.listAllFeatureFlags.useQuery();
  const updateFlag = trpc.platform.updateFeatureFlag.useMutation({
    onSuccess: () => {
      utils.platform.listAllFeatureFlags.invalidate();
      toast('Feature flag actualizado', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al actualizar feature flag', { type: 'error' }); },
  });

  // Track local toggle states for optimistic updates
  const [localToggles, setLocalToggles] = useState<Record<string, boolean>>({});

  // Selected flag key for override panel
  const [selectedFlagKey, setSelectedFlagKey] = useState<string>('');

  const flags = flagGroups ?? [];

  // Auto-select first flag if none selected
  const activeFlagKey = selectedFlagKey || (flags.length > 0 ? flags[0].key : '');

  // Get entries for the selected flag
  const selectedFlagEntries = useMemo(() => {
    const group = flags.find(f => f.key === activeFlagKey);
    return group?.entries ?? [];
  }, [flags, activeFlagKey]);

  function handleToggle(orgId: string, key: string, currentEnabled: boolean) {
    const newEnabled = !currentEnabled;
    const toggleKey = `${orgId}:${key}`;
    setLocalToggles(prev => ({ ...prev, [toggleKey]: newEnabled }));
    updateFlag.mutate({ organizationId: orgId, key, enabled: newEnabled });
  }

  function getEffectiveEnabled(orgId: string, key: string, dbEnabled: boolean): boolean {
    const toggleKey = `${orgId}:${key}`;
    if (toggleKey in localToggles) return localToggles[toggleKey];
    return dbEnabled;
  }

  // Format date
  function formatDate(date: string | Date | null | undefined): string {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 animate-pulse h-[52px]" />
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-8 text-center">
          <p className="text-[13px] text-[#8B8B8B]">Cargando feature flags...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* INFO BANNER */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center gap-3">
        <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <p className="text-[12px] text-blue-700">
          Los feature flags controlan que modulos y funcionalidades estan disponibles para cada organizacion. Los cambios se aplican en tiempo real.
        </p>
      </div>

      {/* FEATURE FLAGS TABLE */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden mb-4">
        {flags.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-10 h-10 mx-auto mb-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
            </svg>
            <p className="text-[13px] text-[#8B8B8B]">No hay feature flags configurados</p>
            <p className="text-[11px] text-[#ABABAB] mt-1">Los flags se crean al configurar modulos para organizaciones</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#EDEDED]">
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Flag Key</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Descripcion</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider text-center">Orgs Activas</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider text-center">Total Overrides</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F3F3]">
              {flags.map(group => {
                const enabledCount = group.entries.filter(e => e.enabled).length;
                const totalEntries = group.entries.length;
                const description = FLAG_DESCRIPTIONS[group.key] || 'Feature flag personalizado';

                return (
                  <tr key={group.key} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-3">
                      <code className="text-[12px] font-mono bg-[#F0EEF7] text-[#1F114C] px-2 py-0.5 rounded">
                        {group.key}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#585858]">
                      {description}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${enabledCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {enabledCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${totalEntries > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                        {totalEntries}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedFlagKey(group.key)}
                          className={`px-2 py-1 text-[10px] rounded font-medium ${activeFlagKey === group.key ? 'text-white bg-[#1F114C]' : 'text-[#1F114C] bg-[#F0EEF7] hover:bg-[#E4E0F0]'}`}
                        >
                          Configurar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* OVERRIDE POR ORGANIZACION PANEL */}
      {activeFlagKey && selectedFlagEntries.length > 0 && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#EDEDED] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
              <p className="text-[13px] font-semibold text-[#1F114C]">Override por Organizacion</p>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F0EEF7] text-[#1F114C]">
                {activeFlagKey}
              </span>
            </div>
            <select
              className="h-8 px-3 border border-[#EDEDED] rounded-lg text-[12px] bg-white text-[#585858] focus:outline-none"
              value={activeFlagKey}
              onChange={e => setSelectedFlagKey(e.target.value)}
            >
              {flags.map(f => (
                <option key={f.key} value={f.key}>{f.key}</option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-[#F3F3F3]">
            {selectedFlagEntries.map(entry => {
              const effectiveEnabled = getEffectiveEnabled(entry.organizationId, entry.key, entry.enabled);
              const orgInitials = (entry.organization?.name || 'OR')
                .split(' ')
                .map((w: string) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();

              return (
                <div key={entry.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold">
                      {orgInitials}
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-[#1F114C]">
                        {entry.organization?.name || 'Organizacion'}
                      </p>
                      <p className="text-[10px] text-[#8B8B8B]">
                        Actualizado: {formatDate(entry.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-[11px] font-medium ${effectiveEnabled ? 'text-green-600' : 'text-[#DD0C15]'}`}>
                      {effectiveEnabled ? 'Activado' : 'Desactivado'}
                    </span>
                    <button
                      onClick={() => handleToggle(entry.organizationId, entry.key, effectiveEnabled)}
                      className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${effectiveEnabled ? 'bg-[#1F114C]' : 'bg-gray-300'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${effectiveEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty override state */}
      {activeFlagKey && selectedFlagEntries.length === 0 && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-8 text-center">
          <p className="text-[13px] text-[#8B8B8B]">No hay overrides para este flag</p>
          <p className="text-[11px] text-[#ABABAB] mt-1">Configura organizaciones para agregar overrides</p>
        </div>
      )}
    </div>
  );
}
