'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import type { AiAgentItem } from '../../../../lib/trpc-types';
import { AiInterviewOrgControls, AI_VOICE_INTERVIEW_SLUG } from './ai-interview-org-controls';

type Tab = 'config' | 'orgs' | 'usage';

export function AgentDetailDrawer({ agent, onClose, onSuccess }: { agent: AiAgentItem; onClose: () => void; onSuccess: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('config');

  // Config state
  const [editModel, setEditModel] = useState<'haiku' | 'sonnet'>(agent.model as 'haiku' | 'sonnet');
  const [editCache, setEditCache] = useState(agent.cacheTtlSeconds);
  const [editBatch, setEditBatch] = useState(agent.batchEligible);
  const [editStatus, setEditStatus] = useState<'active' | 'stub' | 'disabled'>(agent.status as 'active' | 'stub' | 'disabled');
  const [editDescription, setEditDescription] = useState(agent.description);

  const utils = trpc.useUtils();
  const updateAgent = trpc.platform.updateAiAgent.useMutation({
    onSuccess: () => { toast(t.aiAgents.updated, { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  // Org configs
  const agentDetail = trpc.platform.getAiAgent.useQuery({ id: agent.id });
  const updateOrgConfig = trpc.platform.updateAiAgentOrgConfig.useMutation({
    onSuccess: () => { agentDetail.refetch(); utils.platform.listAiAgents.invalidate(); toast(t.aiAgents.updated, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  // Usage
  const usage = trpc.platform.getAiAgentUsage.useQuery({ agentId: agent.id, days: 30 });

  const tabs: { key: Tab; label: string }[] = [
    { key: 'config', label: 'Config' },
    { key: 'orgs', label: `Orgs (${agent._count.orgConfigs})` },
    { key: 'usage', label: 'Usage' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-lg h-full overflow-hidden flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#EDEDED] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[16px] font-semibold text-[#1F114C]">{agent.name}</h3>
              <p className="text-[11px] text-[#8B8B8B] font-mono">{agent.slug}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8B8B8B] hover:bg-[#F5F5F5]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 bg-[#F6F6F6] rounded-lg p-0.5">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition ${tab === t.key ? 'bg-white shadow-sm text-[#1F114C]' : 'text-[#8B8B8B]'}`}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* CONFIG TAB */}
          {tab === 'config' && (
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.statusLabel}</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value as typeof editStatus)} className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30">
                  <option value="active">{t.aiAgents.statusActive}</option>
                  <option value="stub">{t.aiAgents.statusStub}</option>
                  <option value="disabled">{t.aiAgents.statusDisabled}</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.modelLabel}</label>
                <select value={editModel} onChange={e => setEditModel(e.target.value as typeof editModel)} className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30">
                  <option value="haiku">Claude Haiku</option>
                  <option value="sonnet">Claude Sonnet</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.cacheTtlLabel}</label>
                <input type="number" min={0} value={editCache} onChange={e => setEditCache(Number(e.target.value))} className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-[#8B8B8B] uppercase">{t.aiAgents.batchLabel}</label>
                <button onClick={() => setEditBatch(!editBatch)} className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${editBatch ? 'bg-[#1F114C]' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${editBatch ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.descriptionLabel}</label>
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} className="w-full px-3 py-2 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30 resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="h-9 px-4 text-[12px] font-medium text-[#585858] bg-[#F5F5F5] rounded-lg hover:bg-[#EDEDED] transition">{t.common.cancel}</button>
                <button
                  onClick={() => updateAgent.mutate({ id: agent.id, model: editModel, cacheTtlSeconds: editCache, batchEligible: editBatch, status: editStatus, description: editDescription })}
                  disabled={updateAgent.isPending}
                  className="h-9 px-4 text-[12px] font-medium text-white bg-[#1F114C] rounded-lg hover:bg-[#2a1866] disabled:opacity-50 transition"
                >
                  {updateAgent.isPending ? t.common.saving : t.aiAgents.saveChanges}
                </button>
              </div>
            </div>
          )}

          {/* ORGS TAB */}
          {tab === 'orgs' && (
            <div className="divide-y divide-[#F3F3F3]">
              {agentDetail.isLoading ? (
                <div className="p-6 text-center text-[12px] text-[#8B8B8B]">{t.common.loading}</div>
              ) : (agentDetail.data?.orgConfigs ?? []).length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[12px] text-[#8B8B8B]">No hay configuraciones por organizacion</p>
                  <p className="text-[10px] text-[#ABABAB] mt-1">Este agente no tiene overrides de orgs</p>
                </div>
              ) : (
                (agentDetail.data?.orgConfigs ?? []).map(config => (
                  <div key={config.id} className="px-6 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold">
                          {(config.organization?.name || 'OR').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-[#1F114C]">{config.organization?.name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] text-[#8B8B8B]">{t.aiAgents.budgetLabel}: $</span>
                            <input
                              key={`${config.id}-${config.monthlyBudget ?? ''}`}
                              type="number"
                              min={0}
                              max={100000}
                              step={1}
                              defaultValue={config.monthlyBudget ?? ''}
                              placeholder={t.aiAgents.noBudget}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const val = raw === '' ? null : Number(raw);
                                if (val !== null && (Number.isNaN(val) || val < 0 || val > 100000)) return;
                                if ((config.monthlyBudget ?? null) === val) return;
                                updateOrgConfig.mutate({ agentId: agent.id, organizationId: config.organization.id, monthlyBudget: val });
                              }}
                              className="w-20 text-[10px] border border-[#EDEDED] rounded px-1.5 py-0.5 outline-none focus:border-[#1F114C]"
                            />
                            <span className="text-[10px] text-[#8B8B8B]">/mo</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[11px] font-medium ${config.enabled ? 'text-green-600' : 'text-[#DD0C15]'}`}>
                          {config.enabled ? t.aiAgents.statusActive : t.aiAgents.statusDisabled}
                        </span>
                        <button
                          onClick={() => updateOrgConfig.mutate({ agentId: agent.id, organizationId: config.organization.id, enabled: !config.enabled })}
                          className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${config.enabled ? 'bg-[#1F114C]' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${config.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    </div>
                    {agent.slug === AI_VOICE_INTERVIEW_SLUG && (
                      <AiInterviewOrgControls
                        config={config}
                        agentId={agent.id}
                        onMutate={updateOrgConfig.mutate}
                        isPending={updateOrgConfig.isPending}
                      />
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* USAGE TAB */}
          {tab === 'usage' && (
            <div className="px-6 py-4 space-y-4">
              {usage.isLoading ? (
                <div className="text-center text-[12px] text-[#8B8B8B] py-8">{t.common.loading}</div>
              ) : usage.data ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                      <p className="text-[20px] font-bold text-[#1F114C]">{usage.data.totalCalls}</p>
                      <p className="text-[10px] text-[#8B8B8B]">Llamadas (30d)</p>
                    </div>
                    <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                      <p className="text-[20px] font-bold text-[#1F114C]">${usage.data.totalCost.toFixed(2)}</p>
                      <p className="text-[10px] text-[#8B8B8B]">Costo Total</p>
                    </div>
                    <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                      <p className="text-[20px] font-bold text-[#1F114C]">{usage.data.avgLatencyMs}ms</p>
                      <p className="text-[10px] text-[#8B8B8B]">Latencia Promedio</p>
                    </div>
                    <div className="bg-[#F6F6F6] rounded-lg p-3 text-center">
                      <p className="text-[20px] font-bold text-[#1F114C]">${usage.data.avgCostPerCall.toFixed(4)}</p>
                      <p className="text-[10px] text-[#8B8B8B]">Costo/Llamada</p>
                    </div>
                  </div>
                  <div className="bg-[#F6F6F6] rounded-lg p-3">
                    <p className="text-[11px] font-semibold text-[#1F114C] mb-2">Tokens</p>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[#8B8B8B]">Input</span>
                      <span className="font-medium text-[#1F114C]">{usage.data.totalInputTokens.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[12px] mt-1">
                      <span className="text-[#8B8B8B]">Output</span>
                      <span className="font-medium text-[#1F114C]">{usage.data.totalOutputTokens.toLocaleString()}</span>
                    </div>
                  </div>
                  {usage.data.totalCalls === 0 && (
                    <p className="text-[11px] text-[#ABABAB] text-center">No hay datos de uso aun. Los datos aparecen cuando el agente procesa solicitudes.</p>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
