'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { formatDate, daysUntil } from '../../../../lib/format-utils';
import { Button } from '../../../../components';
import type { ExpiringTrial } from '../../../../lib/trpc-types';

interface TrialsAlertProps {
  trials: ExpiringTrial[];
  onExtendTrial: (organizationId: string) => void;
  isUpdating: boolean;
}

/** Warning banner for trials ending within 7 days; its one action is labelled with its effect. */
export function TrialsAlert({ trials, onExtendTrial, isUpdating }: TrialsAlertProps) {
  const { t, locale } = useI18n();
  const sb = t.subscriptions;

  if (trials.length === 0) return null;

  return (
    <section
      aria-labelledby="trials-alert-title"
      className="mb-4 shrink-0 rounded-xl border border-warning/30 bg-warning-bg p-4 md:mb-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <svg className="size-5 shrink-0 text-warning" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
        </svg>
        <h2 id="trials-alert-title" className="text-subheading font-semibold text-primary">
          {pluralize(trials.length, { one: sb.trialsExpiringOne, other: sb.trialsExpiringOther }, locale)}
        </h2>
      </div>
      <ul className="space-y-2">
        {trials.map((trial) => {
          const days = trial.trialEndsAt ? daysUntil(trial.trialEndsAt) : 0;
          const orgName = trial.organization?.name || t.subscriptions.organization;
          return (
            <li key={trial.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3">
              <div className="min-w-0">
                <p className="text-body font-medium text-primary">{orgName}</p>
                <p className="text-callout text-secondary">
                  {formatMessage(sb.trialMeta, { users: trial.organization.activeUserCount, slug: trial.organization.slug })}
                </p>
              </div>
              <p className={`text-callout font-medium ${days <= 3 ? 'text-danger' : 'text-warning'}`}>
                {formatMessage(sb.trialEndsOn, { date: formatDate(trial.trialEndsAt) })} ·{' '}
                {pluralize(days, { one: sb.daysLeftOne, other: sb.daysLeftOther }, locale)}
              </p>
              <Button size="sm" variant="secondary" onClick={() => onExtendTrial(trial.organizationId)} disabled={isUpdating}>
                {sb.extend14Days}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
