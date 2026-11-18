'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { Button, DataTable, EmptyState, ErrorState, PageHeader, Select, TextInput } from '../../../../components';
import type { AiAgentItem } from '../../../../lib/trpc-types';
import { AgentDetailDrawer } from './agent-detail-drawer';
import { AiAgentKpis } from './ai-agent-kpis';
import { AgentRow } from './agent-row';
import { AgentListItem } from './agent-list-item';
import { CATEGORY_FILTERS, MVP_SLUGS, type CategoryFilter } from './agent-catalog';

type StatusFilter = '' | 'active' | 'stub' | 'disabled';

export default function PlatformAiAgentsPage() {
  const { t } = useI18n();
  const ai = t.aiAgents;
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [selectedAgent, setSelectedAgent] = useState<AiAgentItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const kpiQuery = trpc.platform.getAiAgentKpis.useQuery();
  const {
    data: agents,
    isLoading,
    isError: agentsError,
    error: agentsLoadError,
    refetch: refetchAgents,
  } = trpc.platform.listAiAgents.useQuery({
    search: search || undefined,
    status: statusFilter || undefined,
  });

  const invalidateAll = () => {
    utils.platform.listAiAgents.invalidate();
    utils.platform.getAiAgentKpis.invalidate();
  };

  const updateAgent = trpc.platform.updateAiAgent.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(ai.updated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
    onSettled: () => setTogglingId(null),
  });
  const seedAgents = trpc.platform.seedAiAgents.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(ai.seedSuccess, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const exportCsv = trpc.platform.exportAgentsCsv.useQuery(undefined, { enabled: false });
  const handleExport = async () => {
    try {
      const result = await exportCsv.refetch();
      if (result.isError || !result.data) throw result.error ?? new Error('export');
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-agents-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(formatMessage(ai.exportDone, { count: result.data.count }), { type: 'success' });
    } catch {
      toast(t.common.exportError, { type: 'error' });
    }
  };

  // "Registry empty" comes from the unfiltered KPI total — the list follows the search and status filters.
  const registryEmpty = !kpiQuery.isError && kpiQuery.data?.total === 0;
  const hasFilters = search !== '' || categoryFilter !== 'all' || statusFilter !== '';
  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setStatusFilter('');
  };

  const filteredAgents = (agents ?? []).filter((a) => {
    if (categoryFilter === 'mvp') return MVP_SLUGS.includes(a.slug);
    if (categoryFilter === 'post-mvp') return !MVP_SLUGS.includes(a.slug);
    if (categoryFilter !== 'all') return a.category === categoryFilter;
    return true;
  });

  const toggleAgent = (agent: AiAgentItem) => {
    setTogglingId(agent.id);
    updateAgent.mutate({ id: agent.id, status: agent.status === 'active' ? 'disabled' : 'active' });
  };

  const columns = [
    { key: 'agent', label: ai.colAgent },
    { key: 'model', label: ai.colModel },
    { key: 'status', label: ai.colStatus },
    { key: 'batch', label: ai.colBatch, align: 'center' as const },
    { key: 'cache', label: ai.colCache },
    { key: 'cost', label: ai.colCost, align: 'right' as const },
    { key: 'orgs', label: ai.colOrgs, align: 'center' as const },
    { key: 'actions', label: ai.colActions },
  ];

  const seedAction = {
    label: seedAgents.isPending ? ai.seeding : ai.seedAgents,
    onClick: () => {
      if (!seedAgents.isPending) seedAgents.mutate();
    },
  };
  const empty = registryEmpty ? (
    <EmptyState title={ai.noAgents} description={ai.noAgentsDesc} action={{ ...seedAction, variant: 'secondary' }} />
  ) : (
    <EmptyState
      title={ai.noMatches}
      description={hasFilters ? ai.noMatchesDesc : undefined}
      action={hasFilters ? { label: t.common.clearFilters, onClick: clearFilters, variant: 'secondary' } : undefined}
    />
  );
  const rowProps = (agent: AiAgentItem) => ({
    agent,
    isToggling: togglingId === agent.id,
    onToggle: toggleAgent,
    onOpen: setSelectedAgent,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t.platformSidebar.aiAgents}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={handleExport}
              loading={exportCsv.isFetching}
              loadingLabel={t.common.exporting}
            >
              {ai.exportCsv}
            </Button>
            {registryEmpty && (
              <Button onClick={seedAction.onClick} loading={seedAgents.isPending} loadingLabel={ai.seeding}>
                {ai.seedAgents}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <AiAgentKpis query={kpiQuery} />

        <div role="search" className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-64">
            <label htmlFor="ai-agents-search" className="sr-only">
              {ai.searchLabel}
            </label>
            <TextInput
              id="ai-agents-search"
              type="search"
              placeholder={ai.searchAgents}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-48">
            <label htmlFor="ai-agents-category" className="sr-only">
              {ai.categoryLabel}
            </label>
            <Select
              id="ai-agents-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            >
              {(Object.keys(CATEGORY_FILTERS) as CategoryFilter[]).map((key) => (
                <option key={key} value={key}>
                  {ai.categories[CATEGORY_FILTERS[key]]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <label htmlFor="ai-agents-status" className="sr-only">
              {ai.statusLabel}
            </label>
            <Select
              id="ai-agents-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="">{ai.allStatuses}</option>
              <option value="active">{ai.statusActive}</option>
              <option value="stub">{ai.statusStub}</option>
              <option value="disabled">{ai.statusDisabled}</option>
            </Select>
          </div>
        </div>

        {agentsError ? (
          <div className="rounded-xl bg-white shadow-card">
            <ErrorState onRetry={() => refetchAgents()} error={agentsLoadError} message={ai.loadError} />
          </div>
        ) : (
          <DataTable
            columns={columns}
            loading={isLoading}
            label={t.platformSidebar.aiAgents}
            empty={empty}
            mobileList={filteredAgents.map((agent) => (
              <AgentListItem key={agent.id} {...rowProps(agent)} />
            ))}
          >
            {filteredAgents.map((agent) => (
              <AgentRow key={agent.id} {...rowProps(agent)} />
            ))}
          </DataTable>
        )}
      </div>

      {selectedAgent && (
        <AgentDetailDrawer
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onSuccess={() => {
            setSelectedAgent(null);
            invalidateAll();
          }}
        />
      )}
    </div>
  );
}
