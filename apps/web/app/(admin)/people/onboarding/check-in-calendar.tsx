'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { intlLocale } from '../../../../lib/format-utils';
import { onboardingCheckInTypeLabel, onboardingStatusLabel } from '../../../../lib/onboarding-labels';
import { isPastDue } from '../../../../lib/onboarding-schedule';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge } from '../../../../components';
import type { StatusTone } from '../../../../components';
import { CompleteCheckInModal } from './complete-check-in-modal';
import type { OnboardingPlan } from './onboarding-table';

interface CheckInCalendarProps {
  plans: OnboardingPlan[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  /** onboarding:update — only then is "Completar check-in" offered. */
  canUpdate: boolean;
}

const STATUS_TONE: Record<string, StatusTone> = { completed: 'success', overdue: 'danger', missed: 'danger' };
// Below md each check-in is a stacked card; from md a table row (one DOM, same cell order).
const CELL = 'px-3 py-2 max-md:block max-md:p-0';

/** The persisted check-ins of every listed hire, with "Completar check-in" for pending ones. */
export function CheckInCalendar({ plans, isLoading, isError, error, onRetry, canUpdate }: CheckInCalendarProps) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const rows = plans.flatMap((plan) => plan.checkIns.map((checkIn) => ({ plan, checkIn })));
  const dateFormat = new Intl.DateTimeFormat(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5" aria-labelledby="checkin-calendar-heading">
      <h2 id="checkin-calendar-heading" className="mb-3 text-subheading font-semibold text-primary">
        {t.onboarding.checkinCalendar}
      </h2>
      {isError ? (
        <ErrorState size="compact" onRetry={onRetry} error={error} />
      ) : isLoading ? (
        <Skeleton className="h-24" />
      ) : rows.length === 0 ? (
        <EmptyState size="compact" title={t.onboarding.noCheckinData} />
      ) : (
        <div className="rounded-lg border border-border">
          <table className="w-full text-body max-md:block">
            <thead className="max-md:hidden">
              <tr className="bg-surface text-left text-secondary">
                <th scope="col" className="px-3 py-2 font-medium">{t.onboarding.colEmployee}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.onboarding.colCheckIn}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.onboarding.scheduledDate}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.onboarding.colStatus}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.onboarding.checkInAction}</th>
              </tr>
            </thead>
            <tbody className="max-md:block max-md:divide-y max-md:divide-border">
              {rows.map(({ plan, checkIn }) => {
                const name = `${plan.user.firstName} ${plan.user.lastName}`;
                const typeLabel = onboardingCheckInTypeLabel(t.myOnboarding.labels, checkIn.type);
                const statusKey = checkIn.status === 'pending' && isPastDue(checkIn.scheduledDate) ? 'overdue' : checkIn.status;
                return (
                  <tr
                    key={checkIn.id}
                    className="border-t border-border first:border-t-0 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:gap-y-1 max-md:border-t-0 max-md:p-3"
                  >
                    <td className={`${CELL} font-medium text-primary`}>{name}</td>
                    <td className={`${CELL} text-secondary max-md:col-start-1`}>{typeLabel}</td>
                    <td className={`${CELL} tabular-nums text-secondary max-md:col-start-1`}>
                      {dateFormat.format(new Date(checkIn.scheduledDate))}
                    </td>
                    <td className={`${CELL} max-md:col-start-2 max-md:row-start-1`}>
                      <StatusBadge tone={STATUS_TONE[statusKey] ?? 'neutral'}>
                        {onboardingStatusLabel(t.myOnboarding.labels, statusKey)}
                      </StatusBadge>
                    </td>
                    <td className={`${CELL} max-md:col-span-2`}>
                      {checkIn.status === 'pending' && canUpdate && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSelected({ id: checkIn.id, label: `${name} — ${typeLabel}` })}
                        >
                          {t.onboarding.completeCheckInTitle}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selected && <CompleteCheckInModal id={selected.id} label={selected.label} onClose={() => setSelected(null)} />}
    </section>
  );
}
