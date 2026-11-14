'use client';

import { formatCurrency } from '../../../../lib/format-utils';
import { Button, StatusBadge, Switch } from '../../../../components';
import type { AiAgentItem } from '../../../../lib/trpc-types';
import { MVP_SLUGS, STATUS_TONES, formatCache } from './agent-catalog';
import { useAgentLabels } from './agent-labels';

export interface AgentRowProps {
  agent: AiAgentItem;
  isToggling: boolean;
  onToggle: (agent: AiAgentItem) => void;
  onOpen: (agent: AiAgentItem) => void;
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
      <td className="px-4 py-3 text-body text-secondary">{formatCache(agent.cacheTtlSeconds, ai.noCache, ai.units)}</td>
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
