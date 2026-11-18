'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../../lib/format-utils';
import { Button, EmptyState, StatusBadge } from '../../../../components';
import type { HealthError } from '../../../../lib/trpc-types';

/** Recent audit events that match error signatures. null = the feed could not be read, never "no errors". */
export function RecentErrorsCard({ recentErrors }: { recentErrors: HealthError[] | null }) {
  const { t, locale } = useI18n();
  const h = t.health;
  return (
    <section aria-labelledby="recent-errors-title" className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white p-5 shadow-card">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
        <h2 id="recent-errors-title" className="text-heading font-semibold text-brand">
          {h.recentErrors}
        </h2>
        <Button href="/platform/audit" variant="tertiary" size="sm">
          {h.viewAll}
        </Button>
      </div>
      {recentErrors === null ? (
        <p className="py-6 text-center text-body text-secondary">{h.recentErrorsUnavailable}</p>
      ) : recentErrors.length > 0 ? (
        <ul className="min-h-0 flex-1 space-y-2.5 overflow-y-auto">
          {recentErrors.map((error) => (
            <li key={error.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface-hover p-2.5">
              <StatusBadge tone="neutral" icon="none" className="mt-0.5 shrink-0">
                {h.recorded}
              </StatusBadge>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex flex-wrap items-center gap-x-2">
                  <span className="text-body font-medium text-primary">{error.service}</span>
                  <span className="text-callout text-secondary">{formatRelativeTimeLocale(error.time, locale)}</span>
                </div>
                <p className="truncate text-callout text-secondary">{error.message}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="compact" title={h.noRecentErrors} description={h.auditFeedLimited} />
      )}
    </section>
  );
}
