'use client';

import { formatCurrency } from '../../../../lib/format-utils';
import { StatusBadge, Switch } from '../../../../components';
import { STATUS_TONES } from './agent-catalog';
import { useAgentLabels } from './agent-labels';
import type { AgentRowProps } from './agent-row';

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
