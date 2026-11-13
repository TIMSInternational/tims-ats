'use client';

import { useI18n } from '../../../../../../lib/i18n';
import {
  isProviderAssessmentsStaffEnabled,
  useCandidateProviderAttempts,
  type StaffProviderAttempt,
} from '../../../../../../lib/platform-api/assessment-providers-staff';
import { useVacancyAssessments } from '../../../../../../lib/platform-api/vacancy-assessments';
import { isFitEngineV2Enabled } from '../../../../../../lib/platform-api/fit-engine';
import { ProviderStatusChip } from '../provider-status-chip';
import { ProviderProctoringNote } from '../provider-proctoring-note';
import { fill } from './chart-parts';
import { EnglishProfile } from './english-profile';
import { LiaProfile } from './lia-profile';
import { PcaProfile } from './pca-profile';
import { PersonalityProfile } from './personality-profile';
import { ProviderReportMenu } from './provider-report-menu';

const ORDER = ['lia', 'english', 'personality', 'pca', 'itcia', 'mi'] as const;

/** The newest attempt of each instrument, in the order a recruiter reads them. */
function latestByInstrument(attempts: StaffProviderAttempt[]): StaffProviderAttempt[] {
  const seen = new Set<string>();
  return attempts
    .filter((a) => (seen.has(a.instrument) ? false : (seen.add(a.instrument), true)))
    .sort((a, b) => ORDER.indexOf(a.instrument) - ORDER.indexOf(b.instrument));
}

function ResultBody({
  attempt,
  minimum,
}: {
  attempt: StaffProviderAttempt;
  minimum: { percentile: number | null; cefr: string | null };
}) {
  const { t } = useI18n();
  const r = t.providerAssessments.results;
  const result = attempt.result;
  // A sitting proctoring ended (auto-submitted for review, or voided) says so, in place of the generic states.
  if (attempt.proctoringOutcome && (!result || result.reviewPending))
    return <ProviderProctoringNote outcome={attempt.proctoringOutcome} reasons={result?.validityReasons} />;
  if (!result) return <p className="text-[13px] text-[#6B6B6B]">{r.notReady}</p>;
  if (result.reviewPending) return <p className="text-[13px] text-amber-800">{r.underReview}</p>;
  const profile = result.profile;
  if (profile?.lia) return <LiaProfile lia={profile.lia} minimum={minimum.percentile} />;
  if (profile?.english) return <EnglishProfile english={profile.english} minimum={minimum.cefr} />;
  if (profile?.personality) return <PersonalityProfile personality={profile.personality} />;
  if (profile?.pca) return <PcaProfile pca={profile.pca} />;
  return <p className="text-[13px] text-[#6B6B6B]">{r.noProfile}</p>;
}

function VacancyResults({ vacancyId, attempts }: { vacancyId: string; attempts: StaffProviderAttempt[] }) {
  const { t, locale } = useI18n();
  const r = t.providerAssessments.results;
  const titles: Record<string, string> = {
    lia: r.lia.title,
    english: r.english.title,
    personality: r.personality.title,
    pca: r.pca.title,
  };
  const names = t.candidates.fitInstrumentNames;
  const requirements = useVacancyAssessments(vacancyId);
  const minimumOf = (instrument: string) => {
    const min = requirements.data?.assessments.find((a) => a.instrument === instrument)?.min ?? null;
    return { percentile: min?.globalPercentile ?? null, cefr: min?.cefr ?? null };
  };
  const dateFormat = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', { dateStyle: 'medium' });

  return (
    <>
      {latestByInstrument(attempts).map((attempt) => (
        <section
          key={attempt.attemptId}
          aria-labelledby={`result-${attempt.attemptId}`}
          className="rounded-xl border border-[#EDEDED] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
        >
          <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id={`result-${attempt.attemptId}`} className="text-[15px] font-semibold text-[#1F114C]">
                {titles[attempt.instrument] ?? names[attempt.instrument]}
              </h3>
              {attempt.result && (
                <p className="mt-0.5 text-[12px] text-[#6B6B6B]">
                  {fill(r.completedOn, { date: dateFormat.format(new Date(attempt.result.completedAt)) })}
                  {' · '}
                  {t.providerAssessments.countsIn[attempt.countsIn]}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Company scope only (the profile is there only for it, D6); a voided result has no report. */}
              {attempt.result?.profile && attempt.result.validity !== 'voided' && (
                <ProviderReportMenu attemptId={attempt.attemptId} instrument={attempt.instrument} />
              )}
              <ProviderStatusChip status={attempt.status} />
            </div>
          </header>
          <ResultBody attempt={attempt} minimum={minimumOf(attempt.instrument)} />
        </section>
      ))}
    </>
  );
}

// The Assessments tab's results board: every TIMS result of the candidate in detail, one card per test (newest attempt
// of each), grouped by vacancy. The compact "TIMS Assessments" card keeps statuses and actions; this is where HR reads.
// Profiles come from the C# read only for company-scope readers (D6); anyone else sees no detail here.
export function ProviderResultsBoard({ candidateId }: { candidateId: string }) {
  const { t } = useI18n();
  const r = t.providerAssessments.results;
  const { data } = useCandidateProviderAttempts(candidateId);
  if (
    !isProviderAssessmentsStaffEnabled() ||
    !isFitEngineV2Enabled() ||
    !data ||
    data.consentWithdrawn ||
    data.attempts.length === 0
  )
    return null;

  const byVacancy = new Map<string, StaffProviderAttempt[]>();
  for (const a of data.attempts) byVacancy.set(a.vacancyId, [...(byVacancy.get(a.vacancyId) ?? []), a]);

  return (
    <div className="space-y-4" id="tims-results">
      <div>
        <h2 className="text-[17px] font-semibold text-[#1F114C]">{r.heading}</h2>
        <p className="mt-0.5 text-[13px] text-[#585858]">{r.intro}</p>
      </div>
      {[...byVacancy.entries()].map(([vacancyId, attempts]) => (
        <VacancyResults key={vacancyId} vacancyId={vacancyId} attempts={attempts} />
      ))}
    </div>
  );
}
