'use client';

import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { getInitials } from '../../../../lib/format-utils';
import { EmptyState, ErrorState, Skeleton, StatusBadge, Switch } from '../../../../components';
import type { AiAgentItem } from '../../../../lib/trpc-types';
import { AiInterviewOrgControls, AI_VOICE_INTERVIEW_SLUG } from './ai-interview-org-controls';
import { NumberSettingField } from './number-setting-field';
import type { AgentDetailQuery as DetailQuery } from './query-state';


/** Per-organization enablement and budget for one agent. Each switch and field saves immediately. */
export function AgentOrgsTab({ agent, detail }: { agent: AiAgentItem; detail: DetailQuery }) {
  const { t } = useI18n();
  const ai = t.aiAgents;
  const utils = trpc.useUtils();
  const updateOrgConfig = trpc.platform.updateAiAgentOrgConfig.useMutation({
    onSuccess: () => {
      detail.refetch();
      utils.platform.listAiAgents.invalidate();
      toast(ai.updated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  if (detail.isLoading) {
    return (
      <div aria-busy="true" className="space-y-3">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-9" />
          </div>
        ))}
      </div>
    );
  }
  if (detail.isError) {
    return (
      <ErrorState size="compact" onRetry={() => detail.refetch()} error={detail.error} message={ai.orgsLoadError} />
    );
  }
  const configs = detail.data?.orgConfigs ?? [];
  if (configs.length === 0) {
    return <EmptyState size="compact" title={ai.noOrgConfigs} description={ai.noOrgConfigsDesc} />;
  }

  return (
    <ul className="-my-3 divide-y divide-border">
      {configs.map((config) => {
        const orgName = config.organization?.name ?? '';
        const nameId = `agent-org-${config.id}`;
        return (
          <li key={config.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-caption font-bold text-white"
                >
                  {getInitials(orgName || ai.colOrgs)}
                </div>
                <p id={nameId} className="truncate text-body font-medium text-primary">
                  {orgName}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge tone={config.enabled ? 'success' : 'neutral'}>
                  {config.enabled ? ai.statusActive : ai.statusDisabled}
                </StatusBadge>
                <Switch
                  checked={config.enabled}
                  labelledBy={nameId}
                  disabled={updateOrgConfig.isPending}
                  onChange={() =>
                    updateOrgConfig.mutate({
                      agentId: agent.id,
                      organizationId: config.organization.id,
                      enabled: !config.enabled,
                    })
                  }
                />
              </div>
            </div>
            <div className="mt-3">
              <NumberSettingField
                key={`${config.id}-${config.monthlyBudget ?? ''}`}
                label={ai.budgetLabel}
                help={ai.budgetHelp}
                unit={ai.units.usdPerMonth}
                min={0}
                max={100000}
                step={1}
                defaultValue={config.monthlyBudget ?? null}
                placeholder={ai.noBudget}
                onCommit={(val) =>
                  updateOrgConfig.mutate({
                    agentId: agent.id,
                    organizationId: config.organization.id,
                    monthlyBudget: val,
                  })
                }
              />
            </div>
            {agent.slug === AI_VOICE_INTERVIEW_SLUG && (
              <AiInterviewOrgControls
                config={config}
                agentId={agent.id}
                onMutate={updateOrgConfig.mutate}
                isPending={updateOrgConfig.isPending}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
