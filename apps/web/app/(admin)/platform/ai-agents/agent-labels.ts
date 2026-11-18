'use client';

import { useI18n } from '../../../../lib/i18n';
import type { AiAgentItem } from '../../../../lib/trpc-types';

/** Translated status, category and model labels for one agent row. */
export function useAgentLabels(agent: AiAgentItem) {
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
