'use client';

import { forwardRef } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { getInitials } from '../../../../lib/format-utils';
import { EmptyState, StatusBadge, Switch } from '../../../../components';

type FlagGroup = inferRouterOutputs<AppRouter>['platform']['listAllFeatureFlags'][number];

interface FlagOverridesPanelProps {
  flagKey: string;
  entries: FlagGroup['entries'];
  isEnabled: (orgId: string, key: string, dbEnabled: boolean) => boolean;
  pendingToggle: string | null;
  toggleError: { key: string; message: string } | null;
  onToggle: (orgId: string, key: string, current: boolean) => void;
}

/** Per-organization switches for one flag. Each switch applies immediately, so it is a Switch, not a checkbox. */
export const FlagOverridesPanel = forwardRef<HTMLHeadingElement, FlagOverridesPanelProps>(function FlagOverridesPanel(
  { flagKey, entries, isEnabled, pendingToggle, toggleError, onToggle },
  headingRef,
) {
  const { t } = useI18n();
  const ff = t.featureFlags;
  const plans = t.analytics.plans as Record<string, string>;

  return (
    <section aria-labelledby="flag-overrides-title" className="overflow-hidden rounded-xl bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <h2 id="flag-overrides-title" ref={headingRef} tabIndex={-1} className="text-heading font-semibold text-brand">
          {ff.overrideByOrg}
        </h2>
        <code id="flag-overrides-key" className="rounded bg-brand-tint px-2 py-0.5 font-mono text-callout text-brand">{flagKey}</code>
      </div>
      {entries.length === 0 ? (
        <EmptyState size="compact" title={ff.noOverrides} description={ff.noOverridesDesc} />
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => {
            const rowKey = `${entry.organizationId}:${entry.key}`;
            const enabled = isEnabled(entry.organizationId, entry.key, entry.enabled);
            const orgName = entry.organization?.name || ff.unknownOrg;
            const plan = entry.organization?.plan || 'trial';
            const userCount = entry.organization?._count?.users ?? 0;
            const nameId = `flag-org-${entry.id}`;
            const rowError = toggleError?.key === rowKey ? toggleError.message : null;
            return (
              <li key={entry.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-caption font-bold text-white"
                    >
                      {getInitials(orgName)}
                    </div>
                    <div className="min-w-0">
                      <p id={nameId} className="truncate text-body font-medium text-primary">
                        {orgName}
                      </p>
                      <p className="text-callout text-secondary">
                        {formatMessage(ff.orgMeta, { plan: plans[plan] ?? plan, count: userCount })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3" aria-busy={pendingToggle === rowKey || undefined}>
                    <StatusBadge tone={enabled ? 'success' : 'neutral'}>
                      {enabled ? ff.enabled : ff.disabled}
                    </StatusBadge>
                    <Switch
                      checked={enabled}
                      labelledBy={`flag-overrides-key ${nameId}`}
                      disabled={pendingToggle === rowKey}
                      onChange={() => onToggle(entry.organizationId, entry.key, enabled)}
                    />
                  </div>
                </div>
                {rowError && (
                  <p role="alert" className="mt-2 text-callout text-danger">
                    {formatMessage(ff.toggleError, { message: rowError })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
