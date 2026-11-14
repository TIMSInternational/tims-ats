'use client';

import { useI18n } from '../../../lib/i18n';
import { onboardingPhaseLabel, onboardingStatusLabel } from '../../../lib/onboarding-labels';
import { derivedOnboardingPhase } from '../../../lib/onboarding-schedule';
import { intlLocale } from '../../../lib/format-utils';
import { ProgressBar } from '../../../components';

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
  const dateFormat = new Intl.DateTimeFormat(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });

  const facts: { label: string; value: string }[] = [
    { label: m.jobTitle, value: jobTitle?.trim() || m.noJobTitle },
    { label: m.startDate, value: dateFormat.format(new Date(startDate)) },
    { label: m.status, value: onboardingStatusLabel(m.labels, status) },
    // The stored phase is set once at creation; the start date says where the hire is today.
    { label: m.phase, value: onboardingPhaseLabel(m.labels, status === 'active' ? derivedOnboardingPhase(startDate) : phase) },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-border bg-white p-4 shadow-card md:col-span-2 md:p-5">
        <h2 className="text-subheading font-semibold text-primary">{m.planTitle}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-callout text-secondary">{fact.label}</dt>
              <dd className="text-body font-medium text-primary">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <ProgressBar value={progress} label={m.progress} valueText={`${progress}%`} className="mt-4" />
      </div>
      <div className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5">
        <h2 className="text-subheading font-semibold text-primary">{m.buddyTitle}</h2>
        <p className="mt-3 text-body text-primary">{buddy ? `${buddy.firstName} ${buddy.lastName}` : m.noBuddy}</p>
        <p className="mt-1 text-callout text-secondary">{m.buddyExplainer}</p>
      </div>
    </section>
  );
}
