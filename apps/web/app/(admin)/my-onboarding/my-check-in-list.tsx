'use client';

import { useI18n } from '../../../lib/i18n';
import { onboardingCheckInTypeLabel, onboardingStatusLabel } from '../../../lib/onboarding-labels';
import { isPastDue } from '../../../lib/onboarding-schedule';

interface MyCheckInItem {
  id: string;
  type: string;
  scheduledDate: Date | string;
  status: string;
}

interface MyCheckInListProps {
  checkIns: MyCheckInItem[];
}

export function MyCheckInList({ checkIns }: MyCheckInListProps) {
  const { t, locale } = useI18n();
  const m = t.myOnboarding;
  const dateLocale = locale === 'EN' ? 'en' : 'es';

  return (
    <section className="rounded-xl border border-[#EDEDED] bg-white p-5">
      <h2 className="text-sm font-semibold text-[#1F114C]">{m.checkInsTitle}</h2>
      {checkIns.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#8B8B8B]">{m.noCheckIns}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#F0F0F0]">
          {checkIns.map((checkIn) => (
            <li key={checkIn.id} className="flex items-center justify-between py-2.5 text-[13px]">
              <span className="font-medium text-[#333]">{onboardingCheckInTypeLabel(m.labels, checkIn.type)}</span>
              <span className="text-[#585858]">{new Date(checkIn.scheduledDate).toLocaleDateString(dateLocale)}</span>
              {/* B-24: a pending check-in whose day has passed reads "Vencido", not "Pendiente". */}
              {checkIn.status === 'pending' && isPastDue(checkIn.scheduledDate) ? (
                <span className="text-[12px] font-medium text-[#DD0C15]">{onboardingStatusLabel(m.labels, 'overdue')}</span>
              ) : (
                <span className="text-[12px] text-[#585858]">{onboardingStatusLabel(m.labels, checkIn.status)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
