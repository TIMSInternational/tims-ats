'use client';

import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { formatCurrency } from '../../../../../../lib/format-utils';
import { EmptyState, ErrorState, Skeleton, StatusBadge, TEXT_LINK_CLASSES } from '../../../../../../components';

const TH = 'px-4 py-2.5 text-callout font-semibold text-secondary';
const CARD = 'rounded-xl bg-white shadow-card';

export function AiSection({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const { data: configs, isLoading, isError, refetch } = trpc.platform.getOrgAiConfigs.useQuery({ organizationId });

  const categories: Record<string, string> = t.organizations.aiCategories;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-subheading font-semibold text-primary">{t.aiAgents.title}</h2>
        <Link href="/platform/ai-agents" className={`${TEXT_LINK_CLASSES} text-body`}>
          {t.aiAgents.manageAgents}
          <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      {isLoading ? (
        <div className={`${CARD} space-y-4 p-5`} aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1"><Skeleton className="mb-1 h-4 w-32" /><Skeleton className="h-3 w-20" /></div>
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className={CARD}>
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : !configs || configs.length === 0 ? (
        <div className={CARD}>
          <EmptyState
            title={t.aiAgents.noAgentsForOrg}
            action={{ label: t.aiAgents.configureAgents, href: '/platform/ai-agents', variant: 'secondary' }}
          />
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left">
            <caption className="sr-only">{t.aiAgents.title}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={TH}>{t.aiAgents.colAgent}</th>
                <th scope="col" className={TH}>{t.organizations.aiCategoryCol}</th>
                <th scope="col" className={TH}>{t.aiAgents.modelLabel}</th>
                <th scope="col" className={TH}>{t.aiAgents.statusLabel}</th>
                <th scope="col" className={`${TH} text-right`}>{t.aiAgents.monthlyBudget}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {configs.map((cfg) => {
                const agent = cfg.agent;
                const model = agent.model || 'haiku';
                return (
                  <tr key={cfg.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 text-body font-medium text-primary">{agent.name}</td>
                    <td className="px-4 py-3 text-callout text-secondary">{categories[agent.category] ?? agent.category}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone="neutral" icon="none">{model}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={cfg.enabled ? 'success' : 'neutral'}>
                        {cfg.enabled ? t.aiAgents.statusActive : t.users.statusInactive}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right text-body font-medium tabular-nums text-primary">
                      {cfg.monthlyBudget ? formatCurrency(Number(cfg.monthlyBudget), 'USD', 2) : '\u2014'}
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
