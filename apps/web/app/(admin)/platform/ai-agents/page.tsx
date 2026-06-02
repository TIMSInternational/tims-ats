'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, DataTable, EmptyState } from '../../../../components';
import type { AiAgentItem } from '../../../../lib/trpc-types';
import { AgentDetailDrawer } from './agent-detail-drawer';

const CATEGORY_LABELS: Record<string, string> = {
  recruitment: 'Reclutamiento', interview: 'Entrevistas', assessment: 'Evaluacion',
  pipeline: 'Pipeline', talent: 'Talento', general: 'General',
};

const CATEGORIES = ['all', 'mvp', 'post-mvp', 'recruitment', 'interview', 'assessment', 'pipeline', 'talent', 'general'] as const;

const STATUS_STYLES: Record<string, { color: string; dot: string }> = {
  active: { color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  stub: { color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  disabled: { color: 'bg-red-100 text-red-600', dot: 'bg-red-500' },
};

const MVP_SLUGS = [
  'cv-parser', 'vacancy-writer', 'inclusive-language', 'candidate-screener',
  'candidate-matcher', 'interview-question-gen', 'interview-summarizer',
  'assessment-evaluator', 'pipeline-optimizer', 'email-composer', 'offer-letter-gen',
];

function formatCache(seconds: number, noCache: string) {
  if (seconds === 0) return noCache;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${Math.round(seconds / 3600)}h`;
}

type StatusFilter = '' | 'active' | 'stub' | 'disabled';

export default function PlatformAiAgentsPage() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [selectedAgent, setSelectedAgent] = useState<AiAgentItem | null>(null);

  const { data: kpis } = trpc.platform.getAiAgentKpis.useQuery();
  const { data: agents, isLoading } = trpc.platform.listAiAgents.useQuery({
    search: search || undefined,
    status: statusFilter || undefined,
  });

  const invalidateAll = () => {
    utils.platform.listAiAgents.invalidate();
    utils.platform.getAiAgentKpis.invalidate();
  };

  const updateAgent = trpc.platform.updateAiAgent.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.aiAgents.updated, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const seedAgents = trpc.platform.seedAiAgents.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.aiAgents.seedSuccess, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const exportCsv = trpc.platform.exportAgentsCsv.useQuery(undefined, { enabled: false });
  const handleExport = async () => {
    const result = await exportCsv.refetch();
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-agents-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`CSV: ${result.data.count} agents`, { type: 'success' });
    }
  };

  const filteredAgents = (agents ?? []).filter(a => {
    if (categoryFilter === 'mvp') return MVP_SLUGS.includes(a.slug);
    if (categoryFilter === 'post-mvp') return !MVP_SLUGS.includes(a.slug);
    if (categoryFilter !== 'all') return a.category === categoryFilter;
    return true;
  });

  const isEmpty = (agents ?? []).length === 0;

  const columns = [
    { key: 'agent', label: t.aiAgents.colAgent },
    { key: 'model', label: t.aiAgents.colModel },
    { key: 'status', label: t.aiAgents.colStatus },
    { key: 'batch', label: t.aiAgents.colBatch, align: 'center' as const },
    { key: 'cache', label: t.aiAgents.colCache },
    { key: 'cost', label: t.aiAgents.colCost, align: 'right' as const },
    { key: 'orgs', label: t.aiAgents.colOrgs, align: 'center' as const },
    { key: 'actions', label: t.aiAgents.colActions },
  ];

  const emptyIcon = (
    <svg className="w-12 h-12 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  );

  const categoryLabel = (key: string) => {
    if (key === 'all') return t.aiAgents.filterAll;
    if (key === 'mvp') return 'MVP';
    if (key === 'post-mvp') return 'Post-MVP';
    return CATEGORY_LABELS[key] || key;
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-4 shrink-0">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard
              label={t.aiAgents.kpiTotal}
              value={kpis?.total ?? 0}
              subtitle={`${MVP_SLUGS.length} ${t.aiAgents.mvpCount}, ${(kpis?.total ?? 0) - MVP_SLUGS.length} ${t.aiAgents.postMvpCount}`}
              icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>}
              iconBg="bg-[#1F114C]/10"
            />
            <KpiCard
              label={t.aiAgents.kpiActive}
              value={kpis?.active ?? 0}
              subtitle={`${kpis?.total ? Math.round(((kpis?.active ?? 0) / kpis.total) * 100) : 0}% ${t.aiAgents.ofTotal}`}
              icon={<svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.aiAgents.kpiStubs}
              value={kpis?.stubCount ?? 0}
              subtitle={t.aiAgents.pendingImpl}
              valueColor="text-amber-600"
              icon={<svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" /></svg>}
              iconBg="bg-amber-50"
            />
            <KpiCard
              label={t.aiAgents.kpiMonthlySpend}
              value={`$${(kpis?.monthlySpend ?? 0).toFixed(2)}`}
              subtitle={t.aiAgents.last30Days}
              icon={<svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>}
              iconBg="bg-violet-50"
            />
            <KpiCard
              label={`${t.aiAgents.colActions} (30d)`}
              value={kpis?.totalCalls30d ?? 0}
              subtitle={`$${(kpis?.avgCostPerCall ?? 0).toFixed(4)}/${t.aiAgents.colCost.toLowerCase()}`}
              icon={<svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>}
              iconBg="bg-blue-50"
            />
          </>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#ABABAB]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
          <input type="text" placeholder={t.aiAgents.searchAgents} value={search} onChange={e => setSearch(e.target.value)} className="w-full h-9 pl-9 pr-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30" />
        </div>
        <div className="flex items-center gap-0.5 bg-white border border-[#EDEDED] rounded-lg p-0.5 overflow-x-auto">
          {CATEGORIES.map(key => (
            <button key={key} onClick={() => setCategoryFilter(key)} className={`px-2.5 h-7 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap ${categoryFilter === key ? 'bg-[#1F114C] text-white' : 'text-[#585858] hover:bg-[#F5F5F5]'}`}>{categoryLabel(key)}</button>
          ))}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className="h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none">
          <option value="">{t.aiAgents.allStatuses}</option>
          <option value="active">{t.aiAgents.statusActive}</option>
          <option value="stub">{t.aiAgents.statusStub}</option>
          <option value="disabled">{t.aiAgents.statusDisabled}</option>
        </select>
        <div className="flex-1" />
        <button onClick={handleExport} className="h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg text-[#585858] hover:bg-[#F6F6F6] transition flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>CSV
        </button>
        {isEmpty && (
          <button onClick={() => seedAgents.mutate()} disabled={seedAgents.isPending} className="h-9 px-4 text-[12px] font-medium bg-[#1F114C] text-white rounded-lg hover:bg-[#1F114C]/90 disabled:opacity-50 transition-colors">
            {seedAgents.isPending ? t.aiAgents.seeding : t.aiAgents.seedAgents}
          </button>
        )}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        loading={isLoading}
        empty={<EmptyState icon={emptyIcon} message={t.aiAgents.noAgents} description={t.aiAgents.noAgentsDesc} />}
      >
        {filteredAgents.map(agent => {
          const st = STATUS_STYLES[agent.status] ?? STATUS_STYLES.stub;
          const statusLabel = { active: t.aiAgents.statusActive, stub: t.aiAgents.statusStub, disabled: t.aiAgents.statusDisabled }[agent.status] || agent.status;
          const isMvp = MVP_SLUGS.includes(agent.slug);
          return (
            <tr key={agent.id} className="hover:bg-[#FAFAFA] transition-colors border-b border-[#F3F3F3] cursor-pointer" onClick={() => setSelectedAgent(agent)}>
              <td className="px-4 py-3">
                <p className="text-[13px] font-medium text-[#1F114C]">{agent.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-[#ABABAB]">{CATEGORY_LABELS[agent.category] ?? agent.category}</span>
                  {isMvp && <span className="px-1.5 py-0 rounded text-[9px] font-bold bg-[#1F114C]/10 text-[#1F114C]">MVP</span>}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${agent.model === 'sonnet' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                  {agent.model === 'sonnet' ? 'Sonnet' : 'Haiku'}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.color}`}>{statusLabel}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-center">
                {agent.batchEligible ? (
                  <svg className="w-4 h-4 text-green-500 mx-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                ) : <span className="text-[10px] text-[#ABABAB]">RT</span>}
              </td>
              <td className="px-4 py-3"><span className="text-[12px] text-[#585858]">{formatCache(agent.cacheTtlSeconds, t.aiAgents.noCache)}</span></td>
              <td className="px-4 py-3 text-right"><span className="text-[12px] font-mono text-[#585858]">${agent.costPerCall.toFixed(3)}</span></td>
              <td className="px-4 py-3 text-center">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${agent._count.orgConfigs > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>{agent._count.orgConfigs}</span>
              </td>
              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateAgent.mutate({ id: agent.id, status: agent.status === 'active' ? 'disabled' : 'active' })}
                    className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${agent.status === 'active' ? 'bg-[#1F114C]' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${agent.status === 'active' ? 'translate-x-[14px]' : 'translate-x-0'}`} />
                  </button>
                  <button onClick={() => setSelectedAgent(agent)} className="px-2 py-1 text-[10px] rounded font-medium text-[#1F114C] bg-[#F0EEF7] hover:bg-[#E4E0F0] transition-colors">{t.aiAgents.edit}</button>
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>

      {/* Detail Drawer */}
      {selectedAgent && (
        <AgentDetailDrawer
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onSuccess={() => { setSelectedAgent(null); invalidateAll(); }}
        />
      )}
    </div>
  );
}
