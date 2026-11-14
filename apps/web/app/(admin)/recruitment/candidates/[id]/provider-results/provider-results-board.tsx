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
import { ItciaProfile } from './itcia-profile';
import { LiaProfile } from './lia-profile';
import { MiProfile } from './mi-profile';
import { PcaProfile } from './pca-profile';
import { PersonalityProfile } from './personality-profile';
import { ProviderReportMenu } from './provider-report-menu';

/** The order a recruiter reads the tests in; the compact card on the same tab uses it too. */
export const INSTRUMENT_ORDER = ['lia', 'english', 'personality', 'pca', 'itcia', 'mi'] as const;

/** Sorts attempts into INSTRUMENT_ORDER (unknown instruments last, in arrival order). */
export function byInstrumentOrder<T extends { instrument: string }>(a: T, b: T): number {
  const rank = (instrument: string) => {
    const index = (INSTRUMENT_ORDER as readonly string[]).indexOf(instrument);
    return index === -1 ? INSTRUMENT_ORDER.length : index;
  };
  return rank(a.instrument) - rank(b.instrument);
}

/**
 * The current attempt of each instrument, in the order a recruiter reads them: the newest one HR did not cancel, the rule
 * FIT uses to pick the attempt it scores (a cancelled retry never hides the completed attempt before it, Codex ats run 5).
 * With every attempt cancelled, the newest one. The read lists attempts newest first.
 */
export function latestByInstrument(attempts: StaffProviderAttempt[]): StaffProviderAttempt[] {
  const current = new Map<string, StaffProviderAttempt>();
  for (const a of attempts) {
    const held = current.get(a.instrument);
    if (!held || (held.status === 'cancelled' && a.status !== 'cancelled')) current.set(a.instrument, a);
  }
  return [...current.values()].sort(byInstrumentOrder);
}

function ResultBody({
  attempt,
  minimum,
}: {
  attempt: StaffProviderAttempt;
  minimum: { percentile: number | null; cefr: string | null; level: number | null };
}) {
  const { t } = useI18n();
  const r = t.providerAssessments.results;
  const result = attempt.result;
  // A sitting proctoring ended (auto-submitted for review, or voided) says so, in place of the generic states.
  if (attempt.proctoringOutcome && (!result || result.reviewPending))
    return <ProviderProctoringNote outcome={attempt.proctoringOutcome} reasons={result?.validityReasons} />;
  if (!result) return <p className="text-body text-secondary">{r.notReady}</p>;
  if (result.reviewPending) return <p className="text-body text-warning">{r.underReview}</p>;
  const profile = result.profile;
  if (profile?.lia) return <LiaProfile lia={profile.lia} minimum={minimum.percentile} />;
  if (profile?.english) return <EnglishProfile english={profile.english} minimum={minimum.cefr} />;
  if (profile?.personality) return <PersonalityProfile personality={profile.personality} />;
  if (profile?.pca) return <PcaProfile pca={profile.pca} />;
  if (profile?.itcia) return <ItciaProfile itcia={profile.itcia} minimum={minimum.level} />;
  if (profile?.mi) return <MiProfile mi={profile.mi} />;
  return <p className="text-body text-secondary">{r.noProfile}</p>;
}

function VacancyResults({ vacancyId, attempts }: { vacancyId: string; attempts: StaffProviderAttempt[] }) {
  const { t, locale } = useI18n();
  const r = t.providerAssessments.results;
  const titles: Record<string, string> = {
    lia: r.lia.title,
    english: r.english.title,
    personality: r.personality.title,
    pca: r.pca.title,
    itcia: r.itcia.title,
    mi: r.mi.title,
  };
  const names = t.candidates.fitInstrumentNames;
  const requirements = useVacancyAssessments(vacancyId);
  const minimumOf = (instrument: string) => {
    const min = requirements.data?.assessments.find((a) => a.instrument === instrument)?.min ?? null;
    return { percentile: min?.globalPercentile ?? null, cefr: min?.cefr ?? null, level: min?.level ?? null };
  };
  const dateFormat = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', { dateStyle: 'medium' });

  return (
    <>
      {latestByInstrument(attempts).map((attempt) => (
        <section
          key={attempt.attemptId}
          aria-labelledby={`result-${attempt.attemptId}`}
          className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5"
        >
          <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id={`result-${attempt.attemptId}`} className="text-heading font-semibold text-brand">
                {titles[attempt.instrument] ?? names[attempt.instrument]}
              </h3>
              {attempt.result && (
                <p className="mt-0.5 text-callout text-secondary">
                  {fill(r.completedOn, { date: dateFormat.format(new Date(attempt.result.completedAt)) })}
                  {' · '}
                  {t.providerAssessments.countsIn[attempt.countsIn]}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* C# decides by the report endpoints' rule (company scope, D6; valid or under review; detail released). A
                  result lowered to summary has no profile but keeps its report (Codex ats run 7). */}
              {attempt.result?.reportsAvailable && (
                <ProviderReportMenu attemptId={attempt.attemptId} instrument={attempt.instrument} />
              )}
              {/* "Result ready" would only repeat the completion line; any other status is news. */}
              {attempt.status !== 'result_ready' && <ProviderStatusChip status={attempt.status} />}
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
export function ProviderResultsBoard({
  candidateId,
  applications,
}: {
  candidateId: string;
  /** The candidate's applications, to name each vacancy group (the page passes the same list as the card). */
  applications?: readonly { vacancy: { id: string; title: string } }[];
}) {
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

  const titles = applications ? new Map(applications.map((a) => [a.vacancy.id, a.vacancy.title])) : null;
  const byVacancy = new Map<string, StaffProviderAttempt[]>();
  for (const a of data.attempts) byVacancy.set(a.vacancyId, [...(byVacancy.get(a.vacancyId) ?? []), a]);

  return (
    <div className="space-y-4" id="tims-results">
      <div>
        <h2 className="text-title font-semibold text-brand">{r.heading}</h2>
        <p className="mt-0.5 text-body text-secondary">{r.intro}</p>
      </div>
      {[...byVacancy.entries()].map(([vacancyId, attempts]) =>
        titles ? (
          <section key={vacancyId} aria-labelledby={`vacancy-results-${vacancyId}`} className="space-y-4">
            <h3 id={`vacancy-results-${vacancyId}`} className="text-subheading font-semibold text-primary">
              {t.providerAssessments.vacancyLabel}: {titles.get(vacancyId) ?? t.providerAssessments.unknownVacancy}
            </h3>
            <VacancyResults vacancyId={vacancyId} attempts={attempts} />
          </section>
        ) : (
          <VacancyResults key={vacancyId} vacancyId={vacancyId} attempts={attempts} />
        ),
      )}
    </div>
  );
}
