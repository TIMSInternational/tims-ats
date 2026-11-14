'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatCurrency } from '../../../../lib/format-utils';
import { Button, StatusBadge, Switch } from '../../../../components';
import type { AiAgentItem } from '../../../../lib/trpc-types';
import { MVP_SLUGS, STATUS_TONES, formatCache } from './agent-catalog';

interface AgentRowProps {
  agent: AiAgentItem;
  isToggling: boolean;
  onToggle: (agent: AiAgentItem) => void;
  onOpen: (agent: AiAgentItem) => void;
}

function useAgentLabels(agent: AiAgentItem) {
  const { t } = useI18n();
  const ai = t.aiAgents;
  const categories = ai.categories as Record<string, string>;
  const status =
    { active: ai.statusActive, stub: ai.statusStub, disabled: ai.statusDisabled }[agent.status] ?? agent.status;
  return {
    ai,
    status,
    category: categories[agent.category] ?? agent.category,
    model: agent.model === 'sonnet' ? ai.modelSonnet : ai.modelHaiku,
  };
}

/** One registry row. The name opens the drawer; the switch turns the agent on or off immediately. */
export function AgentRow({ agent, isToggling, onToggle, onOpen }: AgentRowProps) {
  const { ai, status, category, model } = useAgentLabels(agent);
  const nameId = `agent-name-${agent.id}`;
  return (
    <tr className="border-b border-border-subtle hover:bg-surface-hover">
      <td className="px-4 py-3">
        <button
          type="button"
          id={nameId}
          onClick={() => onOpen(agent)}
          className="text-left text-body font-medium text-brand hover:underline"
        >
          {agent.name}
        </button>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-callout text-secondary">{category}</span>
          {MVP_SLUGS.includes(agent.slug) && (
            <StatusBadge tone="brand" icon="none">
              {ai.categories.mvp}
            </StatusBadge>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge tone={agent.model === 'sonnet' ? 'brand' : 'info'} icon="none">
          {model}
        </StatusBadge>
      </td>
      <td className="px-4 py-3">
        <StatusBadge tone={STATUS_TONES[agent.status] ?? 'neutral'}>{status}</StatusBadge>
      </td>
      <td className="px-4 py-3 text-center text-body text-secondary">
        {agent.batchEligible ? ai.batchYes : ai.batchRealtime}
      </td>
      <td className="px-4 py-3 text-body text-secondary">{formatCache(agent.cacheTtlSeconds, ai.noCache)}</td>
      <td className="px-4 py-3 text-right text-body tabular-nums text-secondary">
        {formatCurrency(agent.costPerCall, 'USD', 3)}
      </td>
      <td className="px-4 py-3 text-center text-body tabular-nums text-primary">{agent._count.orgConfigs}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={agent.status === 'active'}
            labelledBy={nameId}
            disabled={isToggling}
            onChange={() => onToggle(agent)}
          />
          <Button size="sm" variant="secondary" onClick={() => onOpen(agent)}>
            {ai.edit}
          </Button>
        </div>
      </td>
    </tr>
  );
}

/** The same agent as a stacked row below md. */
export function AgentListItem({ agent, isToggling, onToggle, onOpen }: AgentRowProps) {
  const { status, category, model } = useAgentLabels(agent);
  const nameId = `agent-mobile-name-${agent.id}`;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <button type="button" onClick={() => onOpen(agent)} className="min-w-0 flex-1 text-left">
        <span id={nameId} className="block truncate text-body font-medium text-brand">
          {agent.name}
        </span>
        <span className="block truncate text-callout text-secondary">
          {category} · {model} · {formatCurrency(agent.costPerCall, 'USD', 3)}
        </span>
        <StatusBadge tone={STATUS_TONES[agent.status] ?? 'neutral'} className="mt-1">
          {status}
        </StatusBadge>
      </button>
      <Switch
        checked={agent.status === 'active'}
        labelledBy={nameId}
        disabled={isToggling}
        onChange={() => onToggle(agent)}
      />
    </div>
  );
}
