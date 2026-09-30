'use client';

import { useI18n } from '../../../lib/i18n';
import { onboardingPhaseLabel, onboardingStatusLabel } from '../../../lib/onboarding-labels';

interface BuddyInfo {
  firstName: string;
  lastName: string;
}

interface MyPlanSummaryProps {
  jobTitle: string | null;
  startDate: Date | string;
  status: string;
  phase: string;
  progress: number;
  buddy: BuddyInfo | null;
}

export function MyPlanSummary({ jobTitle, startDate, status, phase, progress, buddy }: MyPlanSummaryProps) {
  const { t, locale } = useI18n();
  const m = t.myOnboarding;
  const dateLocale = locale === 'EN' ? 'en' : 'es';

  const facts: { label: string; value: string }[] = [
    { label: m.jobTitle, value: jobTitle?.trim() || m.noJobTitle },
    { label: m.startDate, value: new Date(startDate).toLocaleDateString(dateLocale) },
    { label: m.status, value: onboardingStatusLabel(m.labels, status) },
    { label: m.phase, value: onboardingPhaseLabel(m.labels, phase) },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5 md:col-span-2">
        <h2 className="text-sm font-semibold text-[#1F114C]">{m.planTitle}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[11px] uppercase tracking-wide text-[#8B8B8B]">{fact.label}</dt>
              <dd className="text-[13px] font-medium text-[#333]">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-[#585858]">
            <span>{m.progress}</span>
            <span>{progress}%</span>
          </div>
          <progress
            value={progress}
            max={100}
            aria-label={m.progress}
            className="mt-1 h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-[#F0F0F0] [&::-webkit-progress-value]:bg-[#1F114C] [&::-moz-progress-bar]:bg-[#1F114C]"
          />
        </div>
      </div>
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5">
        <h2 className="text-sm font-semibold text-[#1F114C]">{m.buddyTitle}</h2>
        <p className="mt-3 text-[13px] text-[#333]">{buddy ? `${buddy.firstName} ${buddy.lastName}` : m.noBuddy}</p>
      </div>
    </section>
  );
}
