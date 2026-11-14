'use client';

import { useI18n } from '../../../lib/i18n';
import { intlLocale } from '../../../lib/format-utils';
import { onboardingCheckInTypeLabel, onboardingStatusLabel } from '../../../lib/onboarding-labels';
import { isPastDue } from '../../../lib/onboarding-schedule';
import { StatusBadge } from '../../../components';
import type { StatusTone } from '../../../components';

interface MyCheckInItem {
  id: string;
  type: string;
  scheduledDate: Date | string;
  status: string;
}

interface MyCheckInListProps {
  checkIns: MyCheckInItem[];
}

const STATUS_TONE: Record<string, StatusTone> = { completed: 'success', overdue: 'danger', missed: 'danger' };

export function MyCheckInList({ checkIns }: MyCheckInListProps) {
  const { t, locale } = useI18n();
  const m = t.myOnboarding;
  const dateFormat = new Intl.DateTimeFormat(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5" aria-labelledby="my-checkins-heading">
      <h2 id="my-checkins-heading" className="text-subheading font-semibold text-primary">
        {m.checkInsTitle}
      </h2>
      <p className="mt-1 text-callout text-secondary">{m.checkInsDesc}</p>
      {checkIns.length === 0 ? (
        <p className="mt-3 text-body text-secondary">{m.noCheckIns}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {checkIns.map((checkIn) => {
            // B-24: a pending check-in whose day has passed reads "Vencido", not "Pendiente".
            const statusKey = checkIn.status === 'pending' && isPastDue(checkIn.scheduledDate) ? 'overdue' : checkIn.status;
            return (
              <li key={checkIn.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 text-body">
                <span className="font-medium text-primary">{onboardingCheckInTypeLabel(m.labels, checkIn.type)}</span>
                <span className="tabular-nums text-secondary">{dateFormat.format(new Date(checkIn.scheduledDate))}</span>
                <StatusBadge tone={STATUS_TONE[statusKey] ?? 'neutral'}>{onboardingStatusLabel(m.labels, statusKey)}</StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
