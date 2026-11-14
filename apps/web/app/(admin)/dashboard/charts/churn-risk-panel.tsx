'use client';

import { useId } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardChurnRisk } from '../../../../lib/platform-api/dashboard';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatCurrency, PLAN_CHIP_FALLBACK, PLAN_BG_CLASSES, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';
import { StatusBadge } from '../../../../components/status-badge';

const CARD = 'flex flex-col rounded-xl border border-border bg-white p-5 shadow-card';

const TIER_CONFIG = {
  green: { bar: 'bg-success', text: 'text-success', row: 'bg-success-bg' },
  yellow: { bar: 'bg-warning', text: 'text-warning', row: 'bg-warning-bg' },
  red: { bar: 'bg-danger', text: 'text-danger', row: 'bg-danger-bg' },
} as const;

function getActionLabel(action: string, t: ReturnType<typeof useI18n>['t']): string {
  const map: Record<string, string> = {
    send_dunning: t.dashboard.sendDunning,
    reactivation_email: t.dashboard.reactivationEmail,
    check_in: t.dashboard.checkIn,
    adoption_call: t.dashboard.adoptionCall,
    onboarding_session: t.dashboard.onboardingSession,
    conversion_call: t.dashboard.conversionCall,
  };
  return map[action] ?? action;
}

function Signal({ value, label, alert }: { value: string | number; label: string; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-callout font-semibold tabular-nums ${alert ? 'text-danger' : 'text-primary'}`}>{value}</p>
      <p className="text-caption text-secondary">{label}</p>
    </div>
  );
}

export function ChurnRiskPanel() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const router = useRouter();
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardChurnRisk();

  if (isLoading) {
    return (
      <div className={CARD} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="mb-4 h-3 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CARD}>
        <ErrorState size="compact" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data) return null;

  const { organizations, summary } = data;
  // Show only at-risk and critical by default, max 10
  const atRiskOrgs = organizations.filter((o) => o.tier !== 'green').slice(0, 10);

  return (
    <section aria-labelledby={titleId} className={CARD}>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-heading font-semibold text-brand">
            {d.churnRisk}
          </h2>
          <p className="text-callout text-secondary">{d.churnSubtitle}</p>
        </div>
        {summary.atRiskMrr > 0 && (
          <div className="text-right">
            <p className="text-title font-bold tabular-nums text-danger">{formatCurrency(summary.atRiskMrr, locale)}</p>
            <p className="text-caption text-secondary">{d.atRiskMrr}</p>
          </div>
        )}
      </div>

      {/* Summary: words and counts, never colour alone */}
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge tone="success">
          {summary.green} {d.green}
        </StatusBadge>
        <StatusBadge tone="warning">
          {summary.yellow} {d.yellow}
        </StatusBadge>
        <StatusBadge tone="danger">
          {summary.red} {d.red}
        </StatusBadge>
      </div>

      {/* Organisations */}
      {atRiskOrgs.length === 0 ? (
        <div className="py-8 text-center">
          <svg
            className="mx-auto mb-2 size-8 text-success"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-subheading font-semibold text-primary">{d.noOrgsAtRisk}</p>
          <p className="mt-0.5 text-callout text-secondary">{d.noOrgsAtRiskDesc}</p>
        </div>
      ) : (
        <ul className="max-h-[340px] space-y-1.5 overflow-y-auto">
          {atRiskOrgs.map((org) => {
            const tierCfg = TIER_CONFIG[org.tier];
            const planClass = PLAN_BG_CLASSES[org.plan] ?? PLAN_CHIP_FALLBACK;
            const primaryAction = org.actions[0];

            return (
              <li key={org.orgId}>
                {/* The row opens the organisation; the suggested action is advice, not a second button. */}
                <button
                  type="button"
                  onClick={() => router.push(`/platform/organizations/${org.orgId}`)}
                  aria-label={formatMessage(d.churnRowLabel, { org: org.orgName, score: org.healthScore })}
                  className={`w-full rounded-lg border border-transparent px-4 py-3 text-left transition-colors hover:border-border ${tierCfg.row}`}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {/* Health score */}
                      <div className="w-10 shrink-0">
                        <p className={`text-center text-subheading font-bold tabular-nums ${tierCfg.text}`}>
                          {org.healthScore}
                        </p>
                        <div className="mt-0.5 h-1.5 w-full rounded-full bg-border">
                          <div
                            className={`h-1.5 rounded-full ${tierCfg.bar}`}
                            style={{ width: `${org.healthScore}%` }}
                          />
                        </div>
                      </div>

                      {/* Org info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 truncate text-body font-medium text-primary">{org.orgName}</span>
                          <span className={`rounded px-1.5 py-0.5 text-caption font-medium ${planClass}`}>
                            {PLAN_LABELS[org.plan] ?? org.plan}
                          </span>
                          {org.mrr > 0 && (
                            <span className="text-caption tabular-nums text-secondary">
                              {formatMessage(d.perMonth, { amount: formatCurrency(org.mrr, locale) })}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-callout text-secondary">{org.primaryRisk}</p>
                      </div>
                    </div>

                    {/* Signals */}
                    <div className="grid shrink-0 grid-cols-3 gap-3">
                      <Signal value={`${org.loginRate}%`} label={d.loginRate} alert={org.loginRate < 30} />
                      <Signal value={org.overdueInvoices} label={d.overdue} alert={org.overdueInvoices > 0} />
                      <Signal value={org.featureCount} label={d.features} />
                    </div>

                    {/* Suggestion text + navigation chevron */}
                    <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                      {primaryAction && (
                        <span className="text-callout text-secondary">
                          {formatMessage(d.suggestedAction, { action: getActionLabel(primaryAction, t) })}
                        </span>
                      )}
                      <svg
                        className="size-4 shrink-0 text-muted"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
