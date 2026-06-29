'use client';

import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { Skeleton } from '../../../../../../components';

const MODEL_BADGES: Record<string, { bg: string; text: string }> = {
  haiku: { bg: 'bg-teal-100', text: 'text-teal-700' },
  sonnet: { bg: 'bg-violet-100', text: 'text-violet-700' },
};

const CATEGORY_COLORS: Record<string, string> = {
  recruitment: 'text-blue-600',
  interview: 'text-amber-600',
  assessment: 'text-emerald-600',
  pipeline: 'text-purple-600',
  hr: 'text-rose-600',
};

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);
}

export function AiSection({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const { data: configs, isLoading } = trpc.platform.getOrgAiConfigs.useQuery({ organizationId });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#333]">{t.aiAgents.title}</h3>
        <Link href="/platform/ai-agents" className="text-xs text-[#1F114C] hover:underline font-medium flex items-center gap-1">
          {t.aiAgents.manageAgents}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1"><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-20" /></div>
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-6 w-11 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : !configs || configs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] py-16 text-center">
          <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.167 3.167 0 01-4.474-.001L9.584 14.5m4.916 0H9.584m4.916 0v4.25A2.25 2.25 0 0112.25 21h-.5A2.25 2.25 0 019.5 18.75V14.5" />
          </svg>
          <p className="text-sm text-[#8B8B8B]">{t.aiAgents.noAgentsForOrg}</p>
          <Link href="/platform/ai-agents" className="text-xs text-[#1F114C] hover:underline font-medium mt-2 inline-block">
            {t.aiAgents.configureAgents}
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-[#EDEDED]">
                <th className="px-5 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.aiAgents.colAgent}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.aiAgents.descriptionLabel}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.aiAgents.modelLabel}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.aiAgents.statusLabel}</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.aiAgents.monthlyBudget}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F3F3]">
              {configs.map((cfg) => {
                const agent = cfg.agent;
                const model = agent.model || 'haiku';
                const modelStyle = MODEL_BADGES[model] || MODEL_BADGES.haiku;
                const catColor = CATEGORY_COLORS[agent.category] || 'text-gray-600';

                return (
                  <tr key={cfg.id} className="hover:bg-[#FAFAFA]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
                          <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5" /></svg>
                        </div>
                        <span className="text-sm font-medium text-[#333]">{agent.name}</span>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-xs font-medium capitalize ${catColor}`}>{agent.category}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${modelStyle.bg} ${modelStyle.text}`}>{model}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-[12px] text-[#585858]">
                        <span className={`w-2 h-2 rounded-full ${cfg.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {cfg.enabled ? t.aiAgents.statusActive : t.users.statusInactive}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#333] font-medium">
                      {cfg.monthlyBudget ? fmtCurrency(Number(cfg.monthlyBudget)) : '\u2014'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
