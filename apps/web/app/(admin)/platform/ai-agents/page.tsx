'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import type { AiAgentItem } from '../../../../lib/trpc-types';

const CATEGORY_LABELS: Record<string, string> = {
  recruitment: 'Reclutamiento',
  interview: 'Entrevistas',
  assessment: 'Evaluacion',
  pipeline: 'Pipeline',
  talent: 'Talento',
  general: 'General',
};

const STATUS_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  active: { label: 'Activo', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  stub: { label: 'Stub', color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  disabled: { label: 'Deshabilitado', color: 'bg-red-100 text-red-600', dot: 'bg-red-500' },
};

const MVP_SLUGS = [
  'cv-parser', 'vacancy-writer', 'inclusive-language', 'candidate-screener',
  'candidate-matcher', 'interview-question-gen', 'interview-summarizer',
  'assessment-evaluator', 'pipeline-optimizer', 'email-composer', 'offer-letter-gen',
];

export default function PlatformAiAgentsPage() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [editingAgent, setEditingAgent] = useState<AiAgentItem | null>(null);

  // Queries
  const { data: kpis } = trpc.platform.getAiAgentKpis.useQuery();
  const { data: agents, isLoading } = trpc.platform.listAiAgents.useQuery({
    search: search || undefined,
    status: statusFilter || undefined,
  });

  // Mutations
  const updateAgent = trpc.platform.updateAiAgent.useMutation({
    onSuccess: () => {
      utils.platform.listAiAgents.invalidate();
      utils.platform.getAiAgentKpis.invalidate();
      setEditingAgent(null);
      toast('Agente IA actualizado', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al actualizar agente', { type: 'error' }); },
  });
  const seedAgents = trpc.platform.seedAiAgents.useMutation({
    onSuccess: () => {
      utils.platform.listAiAgents.invalidate();
      utils.platform.getAiAgentKpis.invalidate();
      toast('Agentes IA sembrados exitosamente', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al sembrar agentes', { type: 'error' }); },
  });

  // Filter by category (MVP/Post-MVP or specific category)
  const filteredAgents = (agents ?? []).filter(a => {
    if (categoryFilter === 'mvp') return MVP_SLUGS.includes(a.slug);
    if (categoryFilter === 'post-mvp') return !MVP_SLUGS.includes(a.slug);
    if (categoryFilter !== 'all') return a.category === categoryFilter;
    return true;
  });

  // Edit modal state
  const [editModel, setEditModel] = useState('');
  const [editCache, setEditCache] = useState(0);
  const [editBatch, setEditBatch] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [editDescription, setEditDescription] = useState('');

  function openEdit(agent: AiAgentItem) {
    setEditingAgent(agent);
    setEditModel(agent.model);
    setEditCache(agent.cacheTtlSeconds);
    setEditBatch(agent.batchEligible);
    setEditStatus(agent.status);
    setEditDescription(agent.description);
  }

  function handleSaveEdit() {
    if (!editingAgent) return;
    updateAgent.mutate({
      id: editingAgent.id,
      model: editModel,
      cacheTtlSeconds: editCache,
      batchEligible: editBatch,
      status: editStatus,
      description: editDescription,
    });
  }

  function handleToggleStatus(agent: AiAgentItem) {
    const newStatus = agent.status === 'active' ? 'disabled' : 'active';
    updateAgent.mutate({ id: agent.id, status: newStatus });
  }

  function formatCost(cost: number) {
    return `$${cost.toFixed(3)}`;
  }

  function formatCache(seconds: number) {
    if (seconds === 0) return 'Sin cache';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
    return `${Math.round(seconds / 3600)}h`;
  }

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden p-5">
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 animate-pulse h-[88px]" />
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-8 text-center">
          <p className="text-[13px] text-[#8B8B8B]">Cargando agentes IA...</p>
        </div>
      </div>
    );
  }

  const isEmpty = (agents ?? []).length === 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-5">
      {/* KPI CARDS */}
      <div className="grid grid-cols-4 gap-4 mb-4 shrink-0">
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <p className="text-[22px] font-bold text-[#1F114C]">{kpis?.total ?? 0}</p>
              <p className="text-[11px] text-[#8B8B8B]">Total Agentes</p>
            </div>
          </div>
          <p className="text-[10px] text-[#ABABAB] mt-2">{MVP_SLUGS.length} MVP, {(kpis?.total ?? 0) - MVP_SLUGS.length} post-MVP</p>
        </div>

        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[22px] font-bold text-[#1F114C]">{kpis?.active ?? 0}</p>
              <p className="text-[11px] text-[#8B8B8B]">Activos</p>
            </div>
          </div>
          <p className="text-[10px] text-[#ABABAB] mt-2">{kpis?.total ? Math.round(((kpis?.active ?? 0) / kpis.total) * 100) : 0}% del total</p>
        </div>

        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
            </div>
            <div>
              <p className="text-[22px] font-bold text-[#1F114C]">{kpis?.stubCount ?? 0}</p>
              <p className="text-[11px] text-[#8B8B8B]">Stubs</p>
            </div>
          </div>
          <p className="text-[10px] text-[#ABABAB] mt-2">Pendientes de implementacion</p>
        </div>

        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <div>
              <p className="text-[22px] font-bold text-[#1F114C]">${(kpis?.monthlySpend ?? 0).toFixed(2)}</p>
              <p className="text-[11px] text-[#8B8B8B]">Gasto Mensual</p>
            </div>
          </div>
          <p className="text-[10px] text-[#ABABAB] mt-2">Ultimos 30 dias</p>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#ABABAB]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar agentes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30"
          />
        </div>

        <div className="flex items-center gap-1 bg-white border border-[#EDEDED] rounded-lg p-0.5">
          {[
            { key: 'all', label: 'Todos' },
            { key: 'mvp', label: 'MVP' },
            { key: 'post-mvp', label: 'Post-MVP' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setCategoryFilter(tab.key)}
              className={`px-3 h-7 text-[11px] font-medium rounded-md transition-colors ${
                categoryFilter === tab.key ? 'bg-[#1F114C] text-white' : 'text-[#585858] hover:bg-[#F5F5F5]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none"
        >
          <option value="">Todos los estados</option>
          <option value="active">Activo</option>
          <option value="stub">Stub</option>
          <option value="disabled">Deshabilitado</option>
        </select>

        {isEmpty && (
          <button
            onClick={() => seedAgents.mutate()}
            disabled={seedAgents.isPending}
            className="ml-auto h-9 px-4 text-[12px] font-medium bg-[#1F114C] text-white rounded-lg hover:bg-[#1F114C]/90 disabled:opacity-50 transition-colors"
          >
            {seedAgents.isPending ? 'Sembrando...' : 'Sembrar 32 Agentes'}
          </button>
        )}
      </div>

      {/* AGENT TABLE */}
      <div className="flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col min-h-0">
        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <p className="text-[13px] text-[#8B8B8B]">No hay agentes IA registrados</p>
              <p className="text-[11px] text-[#ABABAB] mt-1">Usa el boton &quot;Sembrar 32 Agentes&quot; para inicializar el registro</p>
            </div>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-[#EDEDED]">
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Agente</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Modelo</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider text-center">Batch</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Cache</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider text-right">Costo/Llamada</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider text-center">Orgs</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F3F3]">
                {filteredAgents.map(agent => {
                  const st = STATUS_LABELS[agent.status] ?? STATUS_LABELS.stub;
                  const isMvp = MVP_SLUGS.includes(agent.slug);

                  return (
                    <tr key={agent.id} className="hover:bg-[#FAFAFA] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="text-[13px] font-medium text-[#1F114C]">{agent.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-[#ABABAB]">{CATEGORY_LABELS[agent.category] ?? agent.category}</span>
                              {isMvp && (
                                <span className="px-1.5 py-0 rounded text-[9px] font-bold bg-[#1F114C]/10 text-[#1F114C]">MVP</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          agent.model === 'sonnet' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {agent.model === 'sonnet' ? 'Sonnet' : 'Haiku'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.color}`}>
                            {st.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {agent.batchEligible ? (
                          <svg className="w-4 h-4 text-green-500 mx-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <span className="text-[#ccc]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] text-[#585858]">{formatCache(agent.cacheTtlSeconds)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-[12px] font-mono text-[#585858]">{formatCost(agent.costPerCall)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          agent._count.orgConfigs > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {agent._count.orgConfigs}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleStatus(agent)}
                            className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${
                              agent.status === 'active' ? 'bg-[#1F114C]' : 'bg-gray-300'
                            }`}
                            title={agent.status === 'active' ? 'Desactivar' : 'Activar'}
                          >
                            <span
                              className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                agent.status === 'active' ? 'translate-x-[14px]' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <button
                            onClick={() => openEdit(agent)}
                            className="px-2 py-1 text-[10px] rounded font-medium text-[#1F114C] bg-[#F0EEF7] hover:bg-[#E4E0F0] transition-colors"
                          >
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!isEmpty && (
          <div className="border-t border-[#EDEDED] px-4 py-2 flex items-center justify-between shrink-0">
            <p className="text-[11px] text-[#8B8B8B]">
              Mostrando {filteredAgents.length} de {agents?.length ?? 0} agentes
            </p>
          </div>
        )}
      </div>

      {/* EDIT MODAL */}
      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingAgent(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#EDEDED] flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-[#1F114C]">{editingAgent.name}</h3>
                <p className="text-[11px] text-[#8B8B8B]">{editingAgent.slug}</p>
              </div>
              <button onClick={() => setEditingAgent(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8B8B8B] hover:bg-[#F5F5F5]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Status */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Estado</label>
                <select
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value)}
                  className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30"
                >
                  <option value="active">Activo</option>
                  <option value="stub">Stub</option>
                  <option value="disabled">Deshabilitado</option>
                </select>
              </div>

              {/* Model */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Modelo</label>
                <select
                  value={editModel}
                  onChange={e => setEditModel(e.target.value)}
                  className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30"
                >
                  <option value="haiku">Claude Haiku</option>
                  <option value="sonnet">Claude Sonnet</option>
                </select>
              </div>

              {/* Cache TTL */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Cache TTL (segundos)</label>
                <input
                  type="number"
                  min={0}
                  value={editCache}
                  onChange={e => setEditCache(Number(e.target.value))}
                  className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30"
                />
              </div>

              {/* Batch */}
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-[#8B8B8B] uppercase">Batch Eligible</label>
                <button
                  onClick={() => setEditBatch(!editBatch)}
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${editBatch ? 'bg-[#1F114C]' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${editBatch ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Descripcion</label>
                <textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30 resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#EDEDED] flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingAgent(null)}
                className="h-9 px-4 text-[12px] font-medium text-[#585858] bg-[#F5F5F5] rounded-lg hover:bg-[#EDEDED] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={updateAgent.isPending}
                className="h-9 px-4 text-[12px] font-medium text-white bg-[#1F114C] rounded-lg hover:bg-[#1F114C]/90 disabled:opacity-50 transition-colors"
              >
                {updateAgent.isPending ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
