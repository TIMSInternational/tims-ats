'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency } from '../../../../lib/format-utils';
import { ErrorState, Field, Skeleton, TextInput } from '../../../../components';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { NumberSettingField } from './number-setting-field';

type RouterOutput = inferRouterOutputs<AppRouter>;
type OrgConfig = RouterOutput['platform']['getAiAgent']['orgConfigs'][number];

export const AI_VOICE_INTERVIEW_SLUG = 'ai-voice-interview' as const;

interface AiInterviewOrgControlsProps {
  config: OrgConfig;
  agentId: string;
  onMutate: (
    args: Parameters<ReturnType<typeof trpc.platform.updateAiAgentOrgConfig.useMutation>['mutate']>[0],
  ) => void;
  isPending: boolean;
}

export function AiInterviewOrgControls({ config, agentId, onMutate, isPending }: AiInterviewOrgControlsProps) {
  const { t } = useI18n();
  const ai = t.aiAgents;
  const [jsonError, setJsonError] = useState<string | null>(null);
  const organizationId = config.organization.id;

  const billingPreview = trpc.platform.getAiInterviewBillingPreview.useQuery({ organizationId });

  const perTypeCapsDefault =
    config.aiInterviewMaxMinutesByType != null ? JSON.stringify(config.aiInterviewMaxMinutesByType) : '';

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <NumberSettingField
        key={`${config.id}-addonFee-${config.addonMonthlyFeeUsd ?? ''}`}
        label={ai.addonFeeLabel}
        help={ai.addonFeeHelp}
        unit={ai.units.usdPerMonth}
        min={0}
        max={100000}
        step={1}
        defaultValue={config.addonMonthlyFeeUsd ?? null}
        disabled={isPending}
        onCommit={(val) => onMutate({ agentId, organizationId, addonMonthlyFeeUsd: val })}
      />
      <NumberSettingField
        key={`${config.id}-perMin-${config.billableUsdPerMinute ?? ''}`}
        label={ai.perMinuteLabel}
        help={ai.perMinuteHelp}
        unit={ai.units.usdPerMinute}
        min={0}
        max={1000}
        step={0.01}
        defaultValue={config.billableUsdPerMinute ?? null}
        disabled={isPending}
        onCommit={(val) => onMutate({ agentId, organizationId, billableUsdPerMinute: val })}
      />
      <NumberSettingField
        key={`${config.id}-defaultCap-${config.aiInterviewDefaultMaxMinutes ?? ''}`}
        label={ai.defaultCapLabel}
        help={ai.capHelp}
        unit={ai.units.minutes}
        min={1}
        max={180}
        step={1}
        integer
        defaultValue={config.aiInterviewDefaultMaxMinutes ?? null}
        disabled={isPending}
        onCommit={(val) => onMutate({ agentId, organizationId, aiInterviewDefaultMaxMinutes: val })}
      />

      <Field label={ai.perTypeCapsLabel} error={jsonError}>
        <TextInput
          key={`${config.id}-perTypeCaps`}
          defaultValue={perTypeCapsDefault}
          disabled={isPending}
          spellCheck={false}
          className="font-mono"
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              setJsonError(null);
              onMutate({ agentId, organizationId, aiInterviewMaxMinutesByType: null });
              return;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              setJsonError(ai.addonInvalidJson);
              return;
            }
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              setJsonError(ai.addonInvalidJson);
              return;
            }
            const entries = Object.entries(parsed as Record<string, unknown>);
            const isValid = entries.every(
              ([k, v]) => k.length <= 50 && typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 180,
            );
            if (!isValid) {
              setJsonError(ai.addonInvalidJson);
              return;
            }
            setJsonError(null);
            onMutate({
              agentId,
              organizationId,
              aiInterviewMaxMinutesByType: Object.fromEntries(entries.map(([k, v]) => [k, v as number])),
            });
          }}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2 text-body">
        <span className="text-secondary">{ai.accruedUsageLabel}</span>
        {billingPreview.isError ? (
          <ErrorState
            size="inline"
            onRetry={() => billingPreview.refetch()}
            error={billingPreview.error}
            message={ai.usageLoadError}
          />
        ) : billingPreview.isLoading ? (
          <Skeleton className="h-4 w-16" />
        ) : (
          <span className="font-medium tabular-nums text-primary">
            {billingPreview.data?.usageUsd != null ? formatCurrency(billingPreview.data.usageUsd, 'USD', 2) : '—'}
          </span>
        )}
      </div>
    </div>
  );
}
