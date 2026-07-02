'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';

type RouterOutput = inferRouterOutputs<AppRouter>;
type OrgConfig = RouterOutput['platform']['getAiAgent']['orgConfigs'][number];

export const AI_VOICE_INTERVIEW_SLUG = 'ai-voice-interview' as const;

interface AiInterviewOrgControlsProps {
  config: OrgConfig;
  agentId: string;
  onMutate: (args: Parameters<ReturnType<typeof trpc.platform.updateAiAgentOrgConfig.useMutation>['mutate']>[0]) => void;
  isPending: boolean;
}

export function AiInterviewOrgControls({ config, agentId, onMutate, isPending }: AiInterviewOrgControlsProps) {
  const { t } = useI18n();
  const [jsonError, setJsonError] = useState<string | null>(null);

  const billingPreview = trpc.platform.getAiInterviewBillingPreview.useQuery(
    { organizationId: config.organization.id },
  );

  const perTypeCapsDefault =
    config.aiInterviewMaxMinutesByType != null
      ? JSON.stringify(config.aiInterviewMaxMinutesByType)
      : '';

  return (
    <div className="mt-2 space-y-1.5 border-t border-[#F3F3F3] pt-2">
      {/* Add-on fee */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-[#8B8B8B] w-40 shrink-0">{t.aiAgents.addonFeeLabel}</span>
        <span className="text-[10px] text-[#8B8B8B]">$</span>
        <input
          key={`${config.id}-addonFee-${config.addonMonthlyFeeUsd ?? ''}`}
          type="number"
          min={0}
          max={100000}
          step={1}
          defaultValue={config.addonMonthlyFeeUsd ?? ''}
          disabled={isPending}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            const raw = e.target.value.trim();
            const val = raw === '' ? null : Number(raw);
            if (val !== null && (Number.isNaN(val) || val < 0 || val > 100000)) return;
            if ((config.addonMonthlyFeeUsd ?? null) === val) return;
            onMutate({ agentId, organizationId: config.organization.id, addonMonthlyFeeUsd: val });
          }}
          className="w-24 text-[10px] border border-[#EDEDED] rounded px-1.5 py-0.5 outline-none focus:border-[#1F114C] disabled:opacity-50"
        />
      </div>

      {/* Billable per minute */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-[#8B8B8B] w-40 shrink-0">{t.aiAgents.perMinuteLabel}</span>
        <span className="text-[10px] text-[#8B8B8B]">$</span>
        <input
          key={`${config.id}-perMin-${config.billableUsdPerMinute ?? ''}`}
          type="number"
          min={0}
          max={1000}
          step={0.01}
          defaultValue={config.billableUsdPerMinute ?? ''}
          disabled={isPending}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            const raw = e.target.value.trim();
            const val = raw === '' ? null : Number(raw);
            if (val !== null && (Number.isNaN(val) || val < 0 || val > 1000)) return;
            if ((config.billableUsdPerMinute ?? null) === val) return;
            onMutate({ agentId, organizationId: config.organization.id, billableUsdPerMinute: val });
          }}
          className="w-24 text-[10px] border border-[#EDEDED] rounded px-1.5 py-0.5 outline-none focus:border-[#1F114C] disabled:opacity-50"
        />
      </div>

      {/* Default duration cap */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-[#8B8B8B] w-40 shrink-0">{t.aiAgents.defaultCapLabel}</span>
        <input
          key={`${config.id}-defaultCap-${config.aiInterviewDefaultMaxMinutes ?? ''}`}
          type="number"
          min={1}
          max={180}
          step={1}
          defaultValue={config.aiInterviewDefaultMaxMinutes ?? ''}
          disabled={isPending}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            const raw = e.target.value.trim();
            const val = raw === '' ? null : Math.round(Number(raw));
            if (val !== null && (Number.isNaN(val) || val < 1 || val > 180)) return;
            if ((config.aiInterviewDefaultMaxMinutes ?? null) === val) return;
            onMutate({ agentId, organizationId: config.organization.id, aiInterviewDefaultMaxMinutes: val });
          }}
          className="w-24 text-[10px] border border-[#EDEDED] rounded px-1.5 py-0.5 outline-none focus:border-[#1F114C] disabled:opacity-50"
        />
        <span className="text-[10px] text-[#8B8B8B]">min</span>
      </div>

      {/* Per-type caps JSON */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-[#8B8B8B]">{t.aiAgents.perTypeCapsLabel}</span>
        <input
          key={`${config.id}-perTypeCaps`}
          type="text"
          defaultValue={perTypeCapsDefault}
          disabled={isPending}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              setJsonError(null);
              onMutate({ agentId, organizationId: config.organization.id, aiInterviewMaxMinutesByType: null });
              return;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              setJsonError(t.aiAgents.addonInvalidJson);
              return;
            }
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              setJsonError(t.aiAgents.addonInvalidJson);
              return;
            }
            const entries = Object.entries(parsed as Record<string, unknown>);
            const isValid = entries.every(
              ([k, v]) => k.length <= 50 && typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 180,
            );
            if (!isValid) {
              setJsonError(t.aiAgents.addonInvalidJson);
              return;
            }
            setJsonError(null);
            onMutate({
              agentId,
              organizationId: config.organization.id,
              aiInterviewMaxMinutesByType: Object.fromEntries(entries.map(([k, v]) => [k, v as number])),
            });
          }}
          className="w-full text-[10px] border border-[#EDEDED] rounded px-1.5 py-0.5 outline-none focus:border-[#1F114C] font-mono disabled:opacity-50"
        />
        {jsonError && <span className="text-[10px] text-[#DD0C15]">{jsonError}</span>}
      </div>

      {/* Accrued usage preview */}
      <div className="flex items-center gap-1 pt-0.5">
        <span className="text-[10px] text-[#8B8B8B] w-40 shrink-0">{t.aiAgents.accruedUsageLabel}</span>
        {billingPreview.isError ? (
          <ErrorState onRetry={() => billingPreview.refetch()} />
        ) : (
          <span className="text-[10px] font-medium text-[#1F114C]">
            {billingPreview.isLoading
              ? '…'
              : billingPreview.data?.usageUsd != null
                ? `$${billingPreview.data.usageUsd.toFixed(2)}`
                : '—'}
          </span>
        )}
      </div>
    </div>
  );
}
